import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { setupApp, setupSwagger } from './setup-app.js';

async function bootstrap(): Promise<void> {
  // bufferLogs: guarda os logs do boot até o logger do pino estar pronto.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  setupApp(app);
  setupSwagger(app);

  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT', { infer: true }));
}

await bootstrap();
