// Executado antes de cada arquivo e2e. Aponta a API para o banco de TESTE,
// nunca para o de desenvolvimento. No CI, TEST_DATABASE_URL vem do workflow.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://mini_erp:mini_erp@localhost:5433/mini_erp_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
