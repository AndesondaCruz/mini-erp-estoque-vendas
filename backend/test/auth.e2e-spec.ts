import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createUser,
  DEFAULT_PASSWORD,
  refreshCookieFrom,
  resetDatabase,
} from './helpers.js';

describe('Autenticação (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // Sem async: devolve o objeto do Supertest, que aceita .expect() encadeado.
  const login = (email: string, password = DEFAULT_PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });

  describe('POST /auth/login', () => {
    it('devolve o access token no corpo e o refresh token só no cookie', async () => {
      const user = await createUser(app, {
        email: 'ana@loja.com',
        role: 'GERENTE',
      });

      const res = await login('ana@loja.com').expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: user.id,
          name: user.name,
          email: 'ana@loja.com',
          role: 'GERENTE',
          active: true,
        },
      });
      expect(res.body).not.toHaveProperty('refreshToken');

      const cookie = [res.headers['set-cookie']].flat().join(';');
      expect(cookie).toMatch(/refresh_token=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('aceita o e-mail com maiúsculas e espaços', async () => {
      await createUser(app, { email: 'ana@loja.com' });

      await login('  Ana@Loja.COM ').expect(200);
    });

    it('responde a mesma mensagem para senha errada, e-mail inexistente e usuário inativo', async () => {
      await createUser(app, { email: 'ana@loja.com' });
      await createUser(app, { email: 'inativo@loja.com', active: false });

      const responses = await Promise.all([
        login('ana@loja.com', 'senha-errada'),
        login('ninguem@loja.com'),
        login('inativo@loja.com'),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Credenciais inválidas');
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    });

    it('registra sucesso e falhas na auditoria, sem gravar a senha', async () => {
      const user = await createUser(app, { email: 'ana@loja.com' });
      await login('ana@loja.com').expect(200);
      await login('ana@loja.com', 'senha-errada').expect(401);
      await login('ninguem@loja.com').expect(401);

      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'asc' },
      });

      expect(logs.map((l) => l.action)).toEqual([
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGIN_FAILED',
      ]);
      expect(logs[0].userId).toBe(user.id);
      // O e-mail entra em toda falha: é por ele que o bloqueio por conta conta.
      expect(logs[1].metadata).toEqual({
        email: 'ana@loja.com',
        reason: 'WRONG_PASSWORD',
      });
      expect(logs[2]).toMatchObject({
        userId: null,
        metadata: { email: 'ninguem@loja.com', reason: 'UNKNOWN_EMAIL' },
      });
      expect(JSON.stringify(logs)).not.toContain(DEFAULT_PASSWORD);
    });

    it('recusa campos extras e e-mail inválido com 400', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'nao-e-email', password: 'x', role: 'ADMIN' })
        .expect(400);

      expect(res.body.message).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          'property role should not exist',
          'email inválido',
        ]),
      );
    });
  });

  describe('rotas protegidas', () => {
    it('GET /auth/me exige token e devolve o usuário', async () => {
      await createUser(app, { email: 'ana@loja.com', role: 'ADMIN' });
      const { body } = await login('ana@loja.com');

      await http().get('/api/v1/auth/me').expect(401);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer token-falso')
        .expect(401);

      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({ email: 'ana@loja.com', role: 'ADMIN' });
      expect(me.body).not.toHaveProperty('passwordHash');
    });

    it('desativar o usuário invalida o access token na hora', async () => {
      const user = await createUser(app, { email: 'ana@loja.com' });
      const { body } = await login('ana@loja.com');

      await prisma.user.update({
        where: { id: user.id },
        data: { active: false },
      });

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('troca o refresh token por um novo e o antigo deixa de valer', async () => {
      await createUser(app, { email: 'ana@loja.com' });
      const first = refreshCookieFrom(
        (await login('ana@loja.com')).headers['set-cookie'],
      );

      const res = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', first)
        .expect(200);
      const second = refreshCookieFrom(res.headers['set-cookie']);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(second).not.toBe(first);
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', second)
        .expect(200);
    });

    it('sem cookie responde 401', async () => {
      await http().post('/api/v1/auth/refresh').expect(401);
    });

    it('token reapresentado logo após a rotação é corrida (409), sem encerrar a sessão', async () => {
      await createUser(app, { email: 'ana@loja.com' });
      const first = refreshCookieFrom(
        (await login('ana@loja.com')).headers['set-cookie'],
      );
      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', first);
      const second = refreshCookieFrom(rotated.headers['set-cookie']);

      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', first)
        .expect(409);

      // A sessão continua viva: o token novo funciona.
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', second)
        .expect(200);
    });

    it('token antigo reapresentado depois da janela encerra a sessão inteira', async () => {
      const user = await createUser(app, { email: 'ana@loja.com' });
      const first = refreshCookieFrom(
        (await login('ana@loja.com')).headers['set-cookie'],
      );
      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', first);
      const second = refreshCookieFrom(rotated.headers['set-cookie']);

      // Simula que a rotação aconteceu há 1 minuto (fora da janela de 10 s).
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });

      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', first)
        .expect(401);

      // O token legítimo mais recente também foi revogado.
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', second)
        .expect(401);
      const reuse = await prisma.auditLog.findFirst({
        where: { action: 'REFRESH_TOKEN_REUSE' },
      });
      expect(reuse?.userId).toBe(user.id);
    });

    // Regressão de um bug real: as requisições perdedoras analisavam a cópia
    // do token lida ANTES do lock e tratavam a corrida como roubo, derrubando
    // a sessão em 19 de 20 tentativas. Repetimos 5 vezes porque o resultado
    // depende da ordem em que o banco atende as requisições.
    it('renovações simultâneas com o mesmo token: uma vence, as outras recebem 409', async () => {
      for (let round = 0; round < 5; round++) {
        await resetDatabase(app);
        await createUser(app, { email: 'ana@loja.com' });
        const cookie = refreshCookieFrom(
          (await login('ana@loja.com')).headers['set-cookie'],
        );

        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            http().post('/api/v1/auth/refresh').set('Cookie', cookie),
          ),
        );
        const statuses = results.map((r) => r.status).sort((a, b) => a - b);

        expect(statuses).toEqual([200, 409, 409, 409, 409]);
        expect(
          await prisma.auditLog.count({
            where: { action: 'REFRESH_TOKEN_REUSE' },
          }),
        ).toBe(0);
      }
    });
  });

  describe('POST /auth/logout', () => {
    it('revoga a sessão e limpa o cookie', async () => {
      await createUser(app, { email: 'ana@loja.com' });
      const cookie = refreshCookieFrom(
        (await login('ana@loja.com')).headers['set-cookie'],
      );

      const res = await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      expect([res.headers['set-cookie']].flat().join(';')).toMatch(
        /refresh_token=;.*Expires=Thu, 01 Jan 1970/,
      );
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });

    it('é idempotente: sem cookie também responde 204', async () => {
      await http().post('/api/v1/auth/logout').expect(204);
    });
  });

  describe('PATCH /auth/me/password', () => {
    it('troca a senha e encerra todas as sessões, inclusive o access token atual', async () => {
      const user = await createUser(app, { email: 'ana@loja.com' });
      const session1 = await login('ana@loja.com');
      const session2 = await login('ana@loja.com');
      const token = session1.body.accessToken;

      await http()
        .patch('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: DEFAULT_PASSWORD,
          newPassword: 'nova-senha-segura',
        })
        .expect(204);

      // Access token antigo: inválido na hora (tokenVersion mudou).
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      // Refresh tokens das duas sessões: revogados.
      for (const session of [session1, session2]) {
        await http()
          .post('/api/v1/auth/refresh')
          .set('Cookie', refreshCookieFrom(session.headers['set-cookie']))
          .expect(401);
      }
      // Senha antiga não entra mais; a nova entra.
      await login('ana@loja.com').expect(401);
      await login('ana@loja.com', 'nova-senha-segura').expect(200);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'PASSWORD_CHANGED' },
      });
      expect(log).toMatchObject({
        userId: user.id,
        entity: 'User',
        entityId: user.id,
      });
    });

    it('recusa senha atual errada (400) e nova senha curta (400)', async () => {
      await createUser(app, { email: 'ana@loja.com' });
      const { body } = await login('ana@loja.com');
      const auth = { Authorization: `Bearer ${body.accessToken}` };

      const wrong = await http()
        .patch('/api/v1/auth/me/password')
        .set(auth)
        .send({ currentPassword: 'errada', newPassword: 'nova-senha-segura' })
        .expect(400);
      expect(wrong.body.message).toBe('Senha atual incorreta');

      const short = await http()
        .patch('/api/v1/auth/me/password')
        .set(auth)
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'curta' })
        .expect(400);
      expect(short.body.details).toContain(
        'a nova senha deve ter pelo menos 8 caracteres',
      );
    });
  });

  it('a auditoria não pode ser alterada nem apagada, nem pela aplicação', async () => {
    await createUser(app, { email: 'ana@loja.com' });
    await login('ana@loja.com');

    await expect(
      prisma.auditLog.updateMany({ data: { action: 'ADULTERADO' } }),
    ).rejects.toThrow(/somente inserção/);
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(
      /somente inserção/,
    );
  });
});
