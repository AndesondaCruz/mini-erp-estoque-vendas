import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { TOO_MANY_ATTEMPTS } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createUser,
  DEFAULT_PASSWORD,
  resetDatabase,
} from './helpers.js';

const WINDOW_MS = 2000;

describe('Bloqueio de login por conta (e2e)', () => {
  let app: INestApplication<App>;

  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });

  const failTimes = async (email: string, times: number) => {
    for (let i = 0; i < times; i++) {
      await login(email, 'senha-errada-123').expect(401);
    }
  };

  beforeAll(async () => {
    // Antes de importar o AppModule: o ConfigModule lê o ambiente na importação.
    process.env.LOGIN_MAX_FAILURES = '5';
    process.env.LOGIN_FAILURE_WINDOW_MS = String(WINDOW_MS);
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    delete process.env.LOGIN_MAX_FAILURES;
    delete process.env.LOGIN_FAILURE_WINDOW_MS;
    await app.close();
  });

  it('5 falhas bloqueiam a conta: a 6ª tentativa dá 429 mesmo com a senha certa', async () => {
    const user = await createUser(app, { email: 'ana@loja.com' });
    await failTimes(user.email, 5);

    const blocked = await login(user.email, DEFAULT_PASSWORD).expect(429);
    expect(blocked.body.message).toBe(TOO_MANY_ATTEMPTS);

    const audit = await app.get(PrismaService).auditLog.findFirst({
      where: { action: 'LOGIN_FAILED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toEqual({
      email: 'ana@loja.com',
      reason: 'TOO_MANY_ATTEMPTS',
    });
    expect(audit?.userId).toBe(user.id);
  });

  it('o e-mail é comparado sem diferenciar maiúsculas', async () => {
    await createUser(app, { email: 'ana@loja.com' });
    await failTimes('ANA@Loja.com', 5);

    await login('ana@loja.com', DEFAULT_PASSWORD).expect(429);
  });

  it('e-mail inexistente é bloqueado do mesmo jeito (o 429 não revela quem existe)', async () => {
    await failTimes('ninguem@loja.com', 5);

    const res = await login('ninguem@loja.com', 'outra-senha').expect(429);
    expect(res.body.message).toBe(TOO_MANY_ATTEMPTS);
  });

  it('a falha de uma conta não bloqueia outra', async () => {
    await createUser(app, { email: 'ana@loja.com' });
    const other = await createUser(app, { email: 'bia@loja.com' });
    await failTimes('ana@loja.com', 5);

    await login(other.email, DEFAULT_PASSWORD).expect(200);
  });

  it('conta demo nunca é bloqueada (a senha é pública)', async () => {
    const demo = await createUser(app, {
      email: 'vendedor.demo@example.com',
      isDemo: true,
    });
    await failTimes(demo.email, 7);

    await login(demo.email, DEFAULT_PASSWORD).expect(200);
  });

  it('passada a janela, a conta volta a entrar; tentativas bloqueadas não estendem o bloqueio', async () => {
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const user = await createUser(app, { email: 'ana@loja.com' });

    // t = 0: cinco falhas, conta bloqueada até t = WINDOW_MS.
    const start = Date.now();
    await failTimes(user.email, 5);

    // t = 60% da janela: cinco tentativas bloqueadas. Se contassem, ainda
    // estariam dentro da janela quando as falhas originais expirassem.
    await sleep(WINDOW_MS * 0.6 - (Date.now() - start));
    for (let i = 0; i < 5; i++) {
      await login(user.email, DEFAULT_PASSWORD).expect(429);
    }

    // t = janela + 200 ms: as falhas expiraram; as bloqueadas, não.
    await sleep(WINDOW_MS + 200 - (Date.now() - start));
    await login(user.email, DEFAULT_PASSWORD).expect(200);
  });
});
