import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// O CLI do Prisma não lê o .env sozinho. Em desenvolvimento, carregamos o
// arquivo com a função nativa do Node (sem depender do pacote dotenv).
// No CI e no Docker as variáveis já vêm do ambiente, e o arquivo não existe.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
