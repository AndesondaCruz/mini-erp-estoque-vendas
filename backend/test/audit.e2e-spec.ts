import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Role, User } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createUser,
  DEFAULT_PASSWORD,
  resetDatabase,
} from './helpers.js';

describe('Auditoria (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const users = {} as Record<Role, User>;
  const tokens = {} as Record<Role, string>;

  const http = () => request(app.getHttpServer());
  const auth = (role: Role) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);

    for (const role of ['ADMIN', 'GERENTE', 'VENDEDOR'] as const) {
      users[role] = await createUser(app, {
        role,
        email: `${role.toLowerCase()}@loja.com`,
        name: `Pessoa ${role}`,
      });
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: users[role].email, password: DEFAULT_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('permissões', () => {
    it('sem token: 401', async () => {
      await http().get('/api/v1/audit-logs').expect(401);
    });

    it.each(['GERENTE', 'VENDEDOR'] as const)('%s: 403', async (role) => {
      await http().get('/api/v1/audit-logs').set(auth(role)).expect(403);
    });

    it('não existe rota de edição nem de exclusão', async () => {
      const [log] = await prisma.auditLog.findMany({ take: 1 });
      for (const method of ['patch', 'put', 'delete'] as const) {
        await http()
          [method](`/api/v1/audit-logs/${log.id}`)
          .set(auth('ADMIN'))
          .expect(404);
      }
    });
  });

  describe('acesso negado vai para a auditoria', () => {
    it('grava ACCESS_DENIED com o padrão da rota, sem a query string', async () => {
      const before = new Date();
      await http()
        .get(`/api/v1/users/${users.ADMIN.id}?busca=segredo`)
        .set(auth('VENDEDOR'))
        .expect(403);

      const logs = await prisma.auditLog.findMany({
        where: { action: 'ACCESS_DENIED', createdAt: { gte: before } },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        userId: users.VENDEDOR.id,
        metadata: {
          method: 'GET',
          route: '/api/v1/users/:id',
          role: 'VENDEDOR',
          requiredRoles: ['ADMIN'],
        },
      });
      expect(logs[0].ip).toBeTruthy();
      expect(JSON.stringify(logs[0])).not.toContain('segredo');
      // Nem o id pedido: o padrão da rota basta para saber o que foi tentado.
      expect(JSON.stringify(logs[0].metadata)).not.toContain(users.ADMIN.id);
    });

    it('acesso liberado não grava nada', async () => {
      const before = new Date();
      await http().get('/api/v1/auth/me').set(auth('VENDEDOR')).expect(200);
      await http().get('/api/v1/users').set(auth('ADMIN')).expect(200);

      expect(
        await prisma.auditLog.count({
          where: { action: 'ACCESS_DENIED', createdAt: { gte: before } },
        }),
      ).toBe(0);
    });
  });

  describe('GET /audit-logs', () => {
    it('lista do mais recente para o mais antigo, com o usuário junto', async () => {
      const res = await http()
        .get('/api/v1/audit-logs')
        .set(auth('ADMIN'))
        .expect(200);

      const { data, meta } = res.body;
      expect(meta.total).toBe(await prisma.auditLog.count());
      const dates: string[] = data.map(
        (l: { createdAt: string }) => l.createdAt,
      );
      // Datas ISO em UTC ordenam corretamente como texto.
      expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));

      const login = data.find(
        (l: { action: string; user: { id: string } | null }) =>
          l.action === 'LOGIN_SUCCESS' && l.user?.id === users.GERENTE.id,
      );
      expect(login.user).toEqual({
        id: users.GERENTE.id,
        name: 'Pessoa GERENTE',
        email: 'gerente@loja.com',
      });
    });

    it('filtra por usuário e ação', async () => {
      const res = await http()
        .get('/api/v1/audit-logs')
        .query({ userId: users.VENDEDOR.id, action: 'ACCESS_DENIED' })
        .set(auth('ADMIN'))
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      for (const log of res.body.data) {
        expect(log.action).toBe('ACCESS_DENIED');
        expect(log.user.id).toBe(users.VENDEDOR.id);
      }
    });

    it('filtra por entidade e id do registro', async () => {
      const created = await http()
        .post('/api/v1/users')
        .set(auth('ADMIN'))
        .send({
          name: 'Nova Pessoa',
          email: 'nova@loja.com',
          password: 'senha-forte-nova',
          role: 'VENDEDOR',
        })
        .expect(201);

      const res = await http()
        .get('/api/v1/audit-logs')
        .query({ entity: 'User', entityId: created.body.id })
        .set(auth('ADMIN'))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        action: 'USER_CREATED',
        entity: 'User',
        entityId: created.body.id,
        after: { email: 'nova@loja.com', role: 'VENDEDOR' },
      });
      expect(JSON.stringify(res.body.data[0])).not.toContain('passwordHash');
    });

    it('filtra por período: from inclusivo, to exclusivo', async () => {
      const [oldest] = await prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
      });
      const at = oldest.createdAt.toISOString();

      const fromRes = await http()
        .get('/api/v1/audit-logs')
        .query({ from: at, pageSize: 100 })
        .set(auth('ADMIN'))
        .expect(200);
      expect(fromRes.body.data.map((l: { id: string }) => l.id)).toContain(
        oldest.id,
      );

      const toRes = await http()
        .get('/api/v1/audit-logs')
        .query({ to: at })
        .set(auth('ADMIN'))
        .expect(200);
      expect(toRes.body.meta.total).toBe(0);
    });

    it('pagina sem repetir registros', async () => {
      const total = await prisma.auditLog.count();
      const seen = new Set<string>();
      for (let page = 1; page <= Math.ceil(total / 2); page++) {
        const res = await http()
          .get('/api/v1/audit-logs')
          .query({ page, pageSize: 2 })
          .set(auth('ADMIN'))
          .expect(200);
        for (const log of res.body.data as { id: string }[]) {
          expect(seen.has(log.id)).toBe(false);
          seen.add(log.id);
        }
      }
      expect(seen.size).toBe(total);
    });

    it.each([
      [{ action: 'INVENTADA' }],
      [{ entity: 'Category' }],
      [{ userId: 'nao-e-uuid' }],
      [{ from: 'ontem' }],
      [{ sort: 'ip' }],
      [{ from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' }],
    ])('recusa filtro inválido com 400: %o', async (query) => {
      await http()
        .get('/api/v1/audit-logs')
        .query(query)
        .set(auth('ADMIN'))
        .expect(400);
    });
  });
});
