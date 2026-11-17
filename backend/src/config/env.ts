import { z } from 'zod';

// Valida as variáveis de ambiente uma única vez, na inicialização.
// Se algo estiver faltando ou errado, a API nem sobe: é melhor falhar
// no boot do que descobrir o problema na primeira requisição.

const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\//,
      'DATABASE_URL deve ser uma URL postgresql://',
    ),
  // Lista separada por vírgula. Nunca "*": o CORS é restrito por padrão.
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  REPORTS_TIMEZONE: z
    .string()
    .default('America/Fortaleza')
    .refine(isValidTimeZone, 'REPORTS_TIMEZONE não é um fuso IANA válido'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  // Limite mais rígido para rotas sensíveis (login): contra força bruta.
  STRICT_THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  STRICT_THROTTLE_LIMIT: z.coerce.number().int().positive().default(5),
  // Quantos proxies confiáveis existem na frente da API (Render, Vercel).
  // Com 0, req.ip é o IP da conexão; atrás de proxy, seria o IP do proxy.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Segredo do access token: no mínimo 32 caracteres (256 bits para HS256).
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return result.data;
}
