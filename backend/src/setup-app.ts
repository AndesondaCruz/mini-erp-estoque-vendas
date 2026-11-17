import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import type { Env } from './config/env.js';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';

// Configuração global compartilhada entre main.ts e os testes e2e.
// Assim o teste exercita a mesma API que roda em produção.
export function setupApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove campos que o DTO não declara
      forbidNonWhitelisted: true, // e recusa a requisição se vierem
      transform: true, // converte o JSON para a classe do DTO
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Mini-ERP API')
      .setDescription('API de estoque e vendas para pequeno comércio')
      .setVersion('0.1.0')
      .build(),
  );
  SwaggerModule.setup(DOCS_PATH, app, document);
}
