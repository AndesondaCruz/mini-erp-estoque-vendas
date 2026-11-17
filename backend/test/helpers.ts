import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { PasswordService } from '../src/auth/password.service.js';
import type { Role, User } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

/**
 * Sobe a aplicação completa, com a mesma configuração global de produção.
 * O AppModule é importado dinamicamente para que cada arquivo de teste possa
 * ajustar process.env antes (o ConfigModule lê o ambiente na importação).
 */
export async function createTestApp(): Promise<INestApplication<App>> {
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  setupApp(app);
  await app.init();
  return app;
}

/** Apaga todos os dados entre os testes. TRUNCATE não dispara o trigger da auditoria. */
export async function resetDatabase(app: INestApplication): Promise<void> {
  await app
    .get(PrismaService)
    .$executeRawUnsafe(
      'TRUNCATE TABLE audit_logs, refresh_tokens, users RESTART IDENTITY CASCADE',
    );
}

export const DEFAULT_PASSWORD = 'senha-forte-de-teste';

export async function createUser(
  app: INestApplication,
  overrides: Partial<{
    name: string;
    email: string;
    role: Role;
    active: boolean;
    password: string;
  }> = {},
): Promise<User> {
  const passwordHash = await app
    .get(PasswordService)
    .hash(overrides.password ?? DEFAULT_PASSWORD);
  return app.get(PrismaService).user.create({
    data: {
      name: overrides.name ?? 'Usuário de Teste',
      email: overrides.email ?? `user-${crypto.randomUUID()}@teste.com`,
      role: overrides.role ?? 'VENDEDOR',
      active: overrides.active ?? true,
      passwordHash,
    },
  });
}

/** Extrai o valor do cookie de refresh de um Set-Cookie. */
export function refreshCookieFrom(
  setCookie: string[] | string | undefined,
): string {
  const header = [setCookie ?? []]
    .flat()
    .find((c) => c.startsWith('refresh_token='));
  if (!header) throw new Error('Resposta sem cookie refresh_token');
  return header.split(';')[0];
}
