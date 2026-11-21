import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DEMO_ACCOUNT_LOCKED_MESSAGE } from '../src/demo/demo-protection.js';
import type { User } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createUser,
  DEFAULT_PASSWORD,
  resetDatabase,
} from './helpers.js';

describe('DEMO_MODE (e2e)', () => {
  let app: INestApplication<App>;
  let admin: User;
  let demoSeller: User;
  let adminToken: string;

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    // Antes de importar o AppModule: o ConfigModule lê o ambiente na importação.
    process.env.DEMO_MODE = 'true';
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    admin = await createUser(app, {
      email: 'admin@example.com',
      role: 'ADMIN',
      isDemo: true,
    });
    demoSeller = await createUser(app, {
      email: 'vendedor@example.com',
      role: 'VENDEDOR',
      isDemo: true,
    });
    adminToken = await login(admin.email);
  });

  afterAll(async () => {
    delete process.env.DEMO_MODE;
    await app.close();
  });

  it.each([
    ['desativar', { active: false }],
    ['mudar o papel', { role: 'GERENTE' }],
    ['mudar o e-mail', { email: 'invasor@example.com' }],
  ])('ADMIN não consegue %s de uma conta demo (403)', async (_, body) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/users/${demoSeller.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(403);

    expect(res.body.message).toBe(DEMO_ACCOUNT_LOCKED_MESSAGE);
    // A conta continua entrando com as credenciais publicadas.
    await login(demoSeller.email);
  });

  it('conta demo não troca a própria senha (403) e a senha antiga segue valendo', async () => {
    const sellerToken = await login(demoSeller.email);

    await request(app.getHttpServer())
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'outra-senha-forte-123',
      })
      .expect(403);

    await login(demoSeller.email);
  });

  it('o resto continua livre: o ADMIN demo cria e desativa um usuário comum', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Visitante',
        email: 'visitante@example.com',
        password: 'senha-forte-123',
        role: 'VENDEDOR',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);

    const saved = await app
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { id: created.body.id as string } });
    // A API nunca marca uma conta como demo: só o seed faz isso.
    expect(saved).toMatchObject({ active: false, isDemo: false });
  });
});
