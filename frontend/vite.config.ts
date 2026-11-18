import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// URL da API em desenvolvimento (a API roda fora do Vite, na porta 3000).
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // O front chama /api na PRÓPRIA origem (localhost:5173) e o Vite repassa
    // para a API. Assim o cookie de refresh (SameSite=Strict, Path=/api/v1/auth)
    // é de primeira parte e o navegador o envia. Em produção, a Vercel faz
    // o mesmo papel com um rewrite (decisão 7 do plano).
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
