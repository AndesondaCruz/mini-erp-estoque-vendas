import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Role, User } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createUser,
  DEFAULT_PASSWORD,
  refreshCookieFrom,
  resetDatabase,
} from './helpers.js';

describe('Usuários e RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function login(user: Pick<User, 'email'>) {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: DEFAULT_PASSWORD })
      .expect(200);
    return {
      token: res.body.accessToken as string,
      cookie: refreshCookieFrom(res.headers['set-cookie']),
    };
  }

  /** Cria um usuário de cada papel e devolve os tokens. */
  async function seedRoles() {
    const users = {} as Record<Role, User>;
    const tokens = {} as Record<Role, string>;
    for (const role of ['ADMIN', 'GERENTE', 'VENDEDOR'] as const) {
      users[role] = await createUser(app, {
        role,
        email: `${role.toLowerCase()}@loja.com`,
        name: `Pessoa ${role}`,
      });
      tokens[role] = (await login(users[role])).token;
    }
    return { users, tokens };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('matriz de permissões de /users', () => {
    let ctx: Awaited<ReturnType<typeof seedRoles>>;

    beforeAll(async () => {
      await resetDatabase(app);
      ctx = await seedRoles();
    });

    it('sem token: 401 em todas as rotas', async () => {
      await http().get('/api/v1/users').expect(401);
      await http().post('/api/v1/users').send({}).expect(401);
    });

    it.each(['GERENTE', 'VENDEDOR'] as const)(
      '%s: 403 em listar, ver, criar e editar',
      async (role) => {
        const headers = auth(ctx.tokens[role]);
        const someone = ctx.users.VENDEDOR.id;

        await http().get('/api/v1/users').set(headers).expect(403);
        await http().get(`/api/v1/users/${someone}`).set(headers).expect(403);
        await http()
          .post('/api/v1/users')
          .set(headers)
          .send({
            name: 'X',
            email: 'x@loja.com',
            password: 'senha-forte-1',
            role: 'ADMIN',
          })
          .expect(403);
        const res = await http()
          .patch(`/api/v1/users/${someone}`)
          .set(headers)
          .send({ role: 'ADMIN' })
          .expect(403);
        expect(res.body.message).toBe(
          'Seu perfil não tem permissão para esta ação',
        );
      },
    );

    it('ADMIN: 200 na listagem', async () => {
      await http().get('/api/v1/users').set(auth(ctx.tokens.ADMIN)).expect(200);
    });
  });

  describe('CRUD (como ADMIN)', () => {
    let ctx: Awaited<ReturnType<typeof seedRoles>>;
    let adminAuth: Record<string, string>;

    beforeEach(async () => {
      await resetDatabase(app);
      ctx = await seedRoles();
      adminAuth = auth(ctx.tokens.ADMIN);
    });

    it('cria um usuário que consegue fazer login, sem expor o hash', async () => {
      const res = await http()
        .post('/api/v1/users')
        .set(adminAuth)
        .send({
          name: '  Caio Lima ',
          email: 'Caio@Loja.com',
          password: 'senha-forte-1',
          role: 'GERENTE',
        })
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        name: 'Caio Lima',
        email: 'caio@loja.com',
        role: 'GERENTE',
        active: true,
      });
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'caio@loja.com', password: 'senha-forte-1' })
        .expect(200);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'USER_CREATED', entityId: res.body.id },
      });
      expect(log?.userId).toBe(ctx.users.ADMIN.id);
      expect(JSON.stringify(log)).not.toContain('argon2');
    });

    it('e-mail já cadastrado (mesmo com maiúsculas): 409', async () => {
      const res = await http()
        .post('/api/v1/users')
        .set(adminAuth)
        .send({
          name: 'Outro',
          email: 'VENDEDOR@loja.com',
          password: 'senha-forte-1',
          role: 'VENDEDOR',
        })
        .expect(409);
      expect(res.body.message).toBe('E-mail já cadastrado');
    });

    it('valida papel, senha e campos extras: 400', async () => {
      const res = await http()
        .post('/api/v1/users')
        .set(adminAuth)
        .send({
          name: 'X',
          email: 'x@loja.com',
          password: 'curta',
          role: 'DONO',
          tokenVersion: 99,
        })
        .expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          'property tokenVersion should not exist',
          'role deve ser ADMIN, GERENTE ou VENDEDOR',
          'a senha deve ter pelo menos 8 caracteres',
        ]),
      );
    });

    it('lista com paginação, busca, filtro e ordenação', async () => {
      const page = await http()
        .get('/api/v1/users?page=1&pageSize=2&sort=email&order=desc')
        .set(adminAuth)
        .expect(200);
      expect(page.body.meta).toEqual({
        page: 1,
        pageSize: 2,
        total: 3,
        totalPages: 2,
      });
      expect(page.body.data.map((u: User) => u.email)).toEqual([
        'vendedor@loja.com',
        'gerente@loja.com',
      ]);

      const search = await http()
        .get('/api/v1/users?search=GEREN')
        .set(adminAuth)
        .expect(200);
      expect(search.body.data).toHaveLength(1);

      const filtered = await http()
        .get('/api/v1/users?role=ADMIN&active=true')
        .set(adminAuth)
        .expect(200);
      expect(filtered.body.data.map((u: User) => u.role)).toEqual(['ADMIN']);
    });

    it('ordenação só por campos permitidos e pageSize limitado: 400', async () => {
      await http()
        .get('/api/v1/users?sort=passwordHash')
        .set(adminAuth)
        .expect(400);
      await http()
        .get('/api/v1/users?pageSize=1000')
        .set(adminAuth)
        .expect(400);
    });

    it('GET /users/:id: 400 para id inválido e 404 para inexistente', async () => {
      await http().get('/api/v1/users/nao-e-uuid').set(adminAuth).expect(400);
      await http()
        .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .set(adminAuth)
        .expect(404);
    });

    it('ADMIN não pode rebaixar nem desativar a si mesmo: 403', async () => {
      const self = ctx.users.ADMIN.id;
      await http()
        .patch(`/api/v1/users/${self}`)
        .set(adminAuth)
        .send({ role: 'VENDEDOR' })
        .expect(403);
      await http()
        .patch(`/api/v1/users/${self}`)
        .set(adminAuth)
        .send({ active: false })
        .expect(403);
    });

    it('trocar o papel vale na próxima requisição, sem novo login', async () => {
      const gerente = ctx.users.GERENTE;
      await http()
        .patch(`/api/v1/users/${gerente.id}`)
        .set(adminAuth)
        .send({ role: 'ADMIN' })
        .expect(200);

      // O token do GERENTE é o mesmo, mas o papel é lido do banco.
      await http()
        .get('/api/v1/users')
        .set(auth(ctx.tokens.GERENTE))
        .expect(200);
    });

    it('desativar encerra as sessões; reativar não ressuscita o token antigo', async () => {
      const vendedor = ctx.users.VENDEDOR;
      const session = await login(vendedor);

      await http()
        .patch(`/api/v1/users/${vendedor.id}`)
        .set(adminAuth)
        .send({ active: false })
        .expect(200);

      await http().get('/api/v1/auth/me').set(auth(session.token)).expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', session.cookie)
        .expect(401);

      await http()
        .patch(`/api/v1/users/${vendedor.id}`)
        .set(adminAuth)
        .send({ active: true })
        .expect(200);
      // Reativado, mas o access token emitido antes continua inválido.
      await http().get('/api/v1/auth/me').set(auth(session.token)).expect(401);
      // Um login novo funciona.
      await login(vendedor);

      const updates = await prisma.auditLog.count({
        where: { action: 'USER_UPDATED', entityId: vendedor.id },
      });
      expect(updates).toBe(2);
    });
  });

  // Com a regra "não pode se rebaixar", o último ADMIN só some em concorrência:
  // A rebaixa B enquanto B rebaixa A. Sem o lock, as duas transações leem
  // "existem 2 ADMINs" e as duas aprovam, deixando o sistema sem ADMIN.
  it('dois ADMINs rebaixando um ao outro ao mesmo tempo: sempre sobra um', async () => {
    for (let round = 0; round < 5; round++) {
      await resetDatabase(app);
      const a = await createUser(app, { role: 'ADMIN', email: 'a@loja.com' });
      const b = await createUser(app, { role: 'ADMIN', email: 'b@loja.com' });
      const [tokenA, tokenB] = [(await login(a)).token, (await login(b)).token];

      const [resA, resB] = await Promise.all([
        http()
          .patch(`/api/v1/users/${b.id}`)
          .set(auth(tokenA))
          .send({ role: 'VENDEDOR' }),
        http()
          .patch(`/api/v1/users/${a.id}`)
          .set(auth(tokenB))
          .send({ role: 'VENDEDOR' }),
      ]);

      // Uma vence. A outra é barrada de um destes dois jeitos, ambos corretos:
      // - 403 no RolesGuard, se chegou depois que a vencedora confirmou
      //   (o papel é lido do banco, e ela já não é ADMIN);
      // - 409 na transação, se passou pelo guard antes e esperou o lock.
      const [winner, loser] = [resA.status, resB.status].sort((x, y) => x - y);
      expect(winner).toBe(200);
      expect([403, 409]).toContain(loser);

      // A garantia que importa: o sistema nunca fica sem ADMIN ativo.
      expect(
        await prisma.user.count({ where: { role: 'ADMIN', active: true } }),
      ).toBe(1);
    }
  });
});
