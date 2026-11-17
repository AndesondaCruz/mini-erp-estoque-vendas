import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-e2e.ts'],
    // Os arquivos e2e compartilham o mesmo banco: rodam um de cada vez.
    fileParallelism: false,
    // argon2 é lento de propósito; alguns testes fazem vários logins.
    testTimeout: 15_000,
  },
});
