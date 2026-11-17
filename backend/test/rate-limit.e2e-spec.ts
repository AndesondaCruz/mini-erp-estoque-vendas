import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp, resetDatabase } from './helpers.js';

describe('Rate limit do login (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Antes de importar o AppModule: o ConfigModule lê o ambiente na importação.
    process.env.STRICT_THROTTLE_LIMIT = '3';
    app = await createTestApp();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('bloqueia com 429 depois do limite de tentativas', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'alvo@loja.com', password: 'chute' });

    for (let i = 0; i < 3; i++) {
      await attempt().expect(401);
    }
    const blocked = await attempt().expect(429);

    expect(blocked.body.statusCode).toBe(429);
    expect(blocked.headers['retry-after-strict']).toBeDefined();
  });

  it('o limite rígido não vale para as outras rotas', async () => {
    // /auth/me passa pelo limite global (100/min), não pelo rígido (3/min):
    // a 5ª chamada ainda é 401 (sem token), e não 429.
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    }
  });
});
