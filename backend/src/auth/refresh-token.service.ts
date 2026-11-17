import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REFRESH_REUSE_GRACE_MS } from './auth.constants.js';

type Tx = Prisma.TransactionClient;

export type RotationResult =
  | { kind: 'rotated'; userId: string; token: string }
  | { kind: 'invalid' } // não existe ou expirou
  | { kind: 'race' } // outra requisição acabou de rotacionar este token
  | { kind: 'reuse'; userId: string; familyId: string }; // provável roubo

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * SHA-256, e não argon2: o token tem 256 bits aleatórios, então não há
   * dicionário para testar. Um hash rápido e determinístico permite buscar
   * o token pelo hash (WHERE token_hash = ...), o que o argon2 não permite.
   */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Cria um token. Sem familyId, inicia uma sessão (família) nova. */
  async issue(
    tx: Tx,
    userId: string,
    familyId: string = randomUUID(),
  ): Promise<{ id: string; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const created = await tx.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: RefreshTokenService.hashToken(token),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    return { id: created.id, token };
  }

  /** Troca um refresh token válido por um novo, na mesma família. */
  rotate(token: string, now = new Date()): Promise<RotationResult> {
    return this.prisma
      .$transaction(async (tx): Promise<RotationResult> => {
        const current = await tx.refreshToken.findUnique({
          where: { tokenHash: RefreshTokenService.hashToken(token) },
        });
        if (!current || current.expiresAt <= now) return { kind: 'invalid' };

        const next = await this.issue(tx, current.userId, current.familyId);

        // A "reivindicação" do token é um UPDATE condicional e atômico:
        // se duas requisições chegarem juntas, só uma encontra revoked_at nulo.
        const claimed = await tx.refreshToken.updateMany({
          where: { id: current.id, revokedAt: null },
          data: { revokedAt: now, replacedById: next.id },
        });
        if (claimed.count === 1) {
          return { kind: 'rotated', userId: current.userId, token: next.token };
        }

        // A reivindicação falhou: outra requisição revogou o token.
        // NÃO dá para decidir com `current`, lido antes de esperarmos o lock:
        // ele ainda mostra revoked_at nulo. Com isso, toda corrida legítima
        // (duas abas renovando juntas) seria tratada como roubo.
        // Em READ COMMITTED, esta nova leitura já enxerga o que a requisição
        // vencedora confirmou (revoked_at e replaced_by_id preenchidos).
        const fresh = await tx.refreshToken.findUnique({
          where: { id: current.id },
        });

        // O token novo criado acima precisa ser descartado:
        // lançar o erro desfaz a transação inteira.
        throw new TokenAlreadyUsed(fresh ?? current);
      })
      .catch((error: unknown) => {
        if (!(error instanceof TokenAlreadyUsed)) throw error;
        const { revokedAt, replacedById, userId, familyId } = error.token;
        const recentlyRotated =
          replacedById !== null &&
          revokedAt !== null &&
          now.getTime() - revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
        return recentlyRotated
          ? ({ kind: 'race' } as const)
          : ({ kind: 'reuse', userId, familyId } as const);
      });
  }

  /** Encerra uma sessão: revoga todos os tokens ainda ativos da família. */
  async revokeFamily(familyId: string, db: Tx = this.prisma): Promise<void> {
    await db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Encerra todas as sessões do usuário (troca de senha, desativação). */
  async revokeAllForUser(userId: string, db: Tx = this.prisma): Promise<void> {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Dono e família de um token, sem validar expiração (usado no logout). */
  findByToken(token: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash: RefreshTokenService.hashToken(token) },
      select: { userId: true, familyId: true },
    });
  }
}

class TokenAlreadyUsed extends Error {
  constructor(
    readonly token: {
      userId: string;
      familyId: string;
      revokedAt: Date | null;
      replacedById: string | null;
    },
  ) {
    super('Refresh token já utilizado');
  }
}
