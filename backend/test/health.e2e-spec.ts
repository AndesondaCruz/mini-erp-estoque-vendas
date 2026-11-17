import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/setup-app.js';

describe('Fundação da API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde ok com o banco de verdade', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('devolve um x-request-id em toda resposta', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
  });

  it('reaproveita o x-request-id enviado pelo cliente', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'meu-id-123');

    expect(res.headers['x-request-id']).toBe('meu-id-123');
  });

  it('aplica os cabeçalhos de segurança do helmet', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('libera CORS só para a origem configurada', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');
    const blocked = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://site-malicioso.com');

    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde rota inexistente no formato padrão de erro', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nao-existe')
      .expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/api/v1/nao-existe',
    });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(typeof res.body.timestamp).toBe('string');
  });
});
