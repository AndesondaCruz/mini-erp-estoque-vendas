import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { STRICT_THROTTLE_KEY } from './common/throttle/strict-throttle.decorator.js';
import { type Env, validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductsModule } from './products/products.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[\w-]{1,64}$/;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProduction =
          config.get('NODE_ENV', { infer: true }) === 'production';
        const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
        return {
          pinoHttp: {
            level: isTest ? 'silent' : config.get('LOG_LEVEL', { infer: true }),
            // Em produção: JSON (fácil de filtrar). Em desenvolvimento: texto legível.
            transport:
              isProduction || isTest ? undefined : { target: 'pino-pretty' },
            // Reaproveita o id enviado pelo cliente (se for seguro) ou gera um novo.
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const incoming = req.headers[REQUEST_ID_HEADER];
              const id =
                typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader(REQUEST_ID_HEADER, id);
              return id;
            },
            // Nunca grava tokens nem cookies no log: nem os que chegam na
            // requisição, nem o refresh token que sai no Set-Cookie da resposta.
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            // O healthcheck do Docker chama /health a cada 10s: sem isso,
            // essas linhas encobririam os logs que importam.
            autoLogging: {
              ignore: (req: IncomingMessage) =>
                req.url?.startsWith('/api/v1/health') ?? false,
            },
          },
        };
      },
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const reflector = new Reflector();
        return [
          {
            name: 'default',
            ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
          {
            // Só vale nas rotas marcadas com @StrictThrottle() (login, troca de senha).
            name: 'strict',
            ttl: config.get('STRICT_THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('STRICT_THROTTLE_LIMIT', { infer: true }),
            skipIf: (context) =>
              !reflector.getAllAndOverride<boolean>(STRICT_THROTTLE_KEY, [
                context.getHandler(),
                context.getClass(),
              ]),
          },
        ];
      },
    }),

    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    CategoriesModule,
    SuppliersModule,
    ProductsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
