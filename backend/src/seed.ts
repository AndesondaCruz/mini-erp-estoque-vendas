/**
 * Cria o primeiro ADMIN, se ainda não existir nenhum.
 *
 * Idempotente: rodar de novo não cria um segundo ADMIN nem troca a senha.
 * As credenciais vêm do ambiente (SEED_ADMIN_*), nunca do código.
 *
 *   Local:   npm run seed
 *   Docker:  docker compose exec api node dist/seed.js
 */
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PasswordService } from './auth/password.service.js';
import { PASSWORD_MIN } from './auth/dto/change-password.dto.js';
import { PrismaClient } from './generated/prisma/client.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const seedEnv = z
  .object({
    DATABASE_URL: z.string().min(1),
    SEED_ADMIN_NAME: z.string().trim().min(1).default('Administrador'),
    SEED_ADMIN_EMAIL: z
      .email('SEED_ADMIN_EMAIL inválido')
      .transform((email) => email.toLowerCase()),
    SEED_ADMIN_PASSWORD: z
      .string()
      .min(
        PASSWORD_MIN,
        `SEED_ADMIN_PASSWORD precisa de ${PASSWORD_MIN}+ caracteres`,
      ),
  })
  .parse(process.env);

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: seedEnv.DATABASE_URL }),
  });

  try {
    const existing = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (existing) {
      console.log(
        `[seed] Já existe um ADMIN (${existing.email}). Nada a fazer.`,
      );
      return;
    }

    const passwordHash = await new PasswordService().hash(
      seedEnv.SEED_ADMIN_PASSWORD,
    );

    await prisma.$transaction(async (tx) => {
      const admin = await tx.user.create({
        data: {
          name: seedEnv.SEED_ADMIN_NAME,
          email: seedEnv.SEED_ADMIN_EMAIL,
          role: 'ADMIN',
          passwordHash,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'USER_CREATED',
          entity: 'User',
          entityId: admin.id,
          after: {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
          },
          metadata: { source: 'seed' },
        },
      });
      console.log(`[seed] ADMIN criado: ${admin.email}`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

await main();
