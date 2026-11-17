import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it('gera hash argon2id com os parâmetros da OWASP (19 MiB, t=2, p=1)', async () => {
    const hash = await service.hash('minha-senha');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain('minha-senha');
  });

  it('verifica a senha certa e recusa a errada', async () => {
    const hash = await service.hash('minha-senha');

    await expect(service.verify(hash, 'minha-senha')).resolves.toBe(true);
    await expect(service.verify(hash, 'outra')).resolves.toBe(false);
  });

  it('hash malformado conta como senha errada, sem lançar erro', async () => {
    await expect(service.verify('nao-e-hash', 'x')).resolves.toBe(false);
  });

  it('a verificação "fantasma" sempre falha', async () => {
    await expect(service.verifyAgainstDummy('qualquer')).resolves.toBe(false);
  });

  it('pede rehash de um hash criado com o padrão antigo (64 MiB)', () => {
    const legacy =
      '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';
    expect(service.needsRehash(legacy)).toBe(true);
  });
});

describe('RefreshTokenService.hashToken', () => {
  it('é determinístico (permite buscar pelo hash) e tem 64 caracteres hex', () => {
    const a = RefreshTokenService.hashToken('token-abc');

    expect(a).toBe(RefreshTokenService.hashToken('token-abc'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(RefreshTokenService.hashToken('token-abd'));
  });
});
