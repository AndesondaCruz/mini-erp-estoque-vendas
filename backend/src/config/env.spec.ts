import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    CORS_ORIGINS: 'http://localhost:5173, https://app.exemplo.com',
  };

  it('aplica os valores padrão', () => {
    const env = validateEnv(valid);

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      REPORTS_TIMEZONE: 'America/Fortaleza',
      THROTTLE_LIMIT: 100,
    });
  });

  it('separa a lista de origens do CORS', () => {
    expect(validateEnv(valid).CORS_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://app.exemplo.com',
    ]);
  });

  it('recusa quando falta DATABASE_URL', () => {
    expect(() => validateEnv({ CORS_ORIGINS: valid.CORS_ORIGINS })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('recusa origem do CORS que não é URL (como "*")', () => {
    expect(() => validateEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('recusa fuso horário inexistente', () => {
    expect(() =>
      validateEnv({ ...valid, REPORTS_TIMEZONE: 'America/Natalzinho' }),
    ).toThrow(/REPORTS_TIMEZONE/);
  });
});
