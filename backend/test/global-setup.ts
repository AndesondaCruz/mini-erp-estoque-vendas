import { execSync } from 'node:child_process';

// Roda uma vez antes de toda a suíte e2e: aplica as migrations no banco de
// TESTE, para os testes rodarem contra o mesmo schema que vai para produção.
export default function setup(): void {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://mini_erp:mini_erp@localhost:5433/mini_erp_test';

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
