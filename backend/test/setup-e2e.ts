// Executado antes de cada arquivo e2e. Aponta a API para o banco de TESTE,
// nunca para o de desenvolvimento. No CI, TEST_DATABASE_URL vem do workflow.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://mini_erp:mini_erp@localhost:5433/mini_erp_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET =
  'segredo-so-para-testes-e2e-com-32-caracteres-ou-mais';
// Alto o bastante para os testes que fazem muitos logins. O arquivo
// rate-limit.e2e-spec.ts redefine este valor para testar o 429.
process.env.STRICT_THROTTLE_LIMIT ??= '1000';
