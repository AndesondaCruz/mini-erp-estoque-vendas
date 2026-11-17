import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { argon2id, hash, needsRehash, verify } from 'argon2';

// Configuração mínima recomendada pela OWASP para argon2id:
// 19 MiB de memória, 2 iterações, paralelismo 1.
// O padrão da biblioteca usa 64 MiB por hash: com o container limitado a
// 384 MB, poucos logins simultâneos derrubariam a API por falta de memória.
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    // Hash de uma senha aleatória, usado quando o e-mail não existe.
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // hash malformado conta como senha errada
    }
  }

  /**
   * Gasta o mesmo tempo de uma verificação real e sempre falha.
   * Sem isso, "e-mail não existe" responderia mais rápido que "senha errada",
   * e um atacante descobriria quais e-mails têm conta só medindo o tempo.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    await this.verify(this.dummyHash, password);
    return false;
  }

  /** True se o hash foi criado com parâmetros diferentes dos atuais. */
  needsRehash(passwordHash: string): boolean {
    return needsRehash(passwordHash, ARGON2_OPTIONS);
  }
}
