import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { assertDemoAccountUnlocked } from '../demo/demo-protection.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type PublicUser,
  toPublicUser,
  UsersService,
} from '../users/users.service.js';
import type { AccessTokenPayload } from './authenticated-user.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

export interface AuthResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: PublicUser;
  /** Vai para o cookie httpOnly; o controller nunca o coloca no corpo. */
  refreshToken: string;
}

// Mesma mensagem para e-mail inexistente, senha errada e usuário inativo:
// a resposta não revela qual dos três aconteceu.
const INVALID_CREDENTIALS = 'Credenciais inválidas';

export const TOO_MANY_ATTEMPTS =
  'Muitas tentativas para esta conta. Tente novamente em alguns minutos.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(
    email: string,
    password: string,
    ip?: string,
  ): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normalizedEmail);

    // Bloqueio por conta, antes de conferir a senha: durante o bloqueio,
    // nem a senha certa entra. Vale igual para e-mail inexistente, senão o
    // 429 revelaria quais e-mails estão cadastrados. Contas demo ficam de
    // fora: a senha delas é pública, e o bloqueio só serviria para alguém
    // tirar a demo do ar errando a senha de propósito.
    if (!user?.isDemo) {
      await this.assertNotLockedOut(normalizedEmail, user?.id, ip);
    }

    if (!user) {
      await this.passwords.verifyAgainstDummy(password);
      await this.audit.record({
        action: 'LOGIN_FAILED',
        metadata: { email: normalizedEmail, reason: 'UNKNOWN_EMAIL' },
        ip,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // A senha é verificada mesmo para usuário inativo: o tempo de resposta
    // fica igual ao de um login normal.
    const passwordOk = await this.passwords.verify(user.passwordHash, password);
    if (!passwordOk || !user.active) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        userId: user.id,
        metadata: {
          // O e-mail entra sempre: é por ele que as falhas são contadas.
          email: normalizedEmail,
          reason: passwordOk ? 'INACTIVE_USER' : 'WRONG_PASSWORD',
        },
        ip,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // Se os parâmetros do argon2 mudaram, atualiza o hash agora,
    // que é o único momento em que temos a senha em texto.
    const passwordHash = this.passwords.needsRehash(user.passwordHash)
      ? await this.passwords.hash(password)
      : undefined;

    const refreshToken = await this.prisma.$transaction(async (tx) => {
      if (passwordHash) {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
      }
      const issued = await this.refreshTokens.issue(tx, user.id);
      await this.audit.record(
        { action: 'LOGIN_SUCCESS', userId: user.id, ip },
        tx,
      );
      return issued.token;
    });

    return this.buildResult(user, refreshToken);
  }

  async refresh(token: string | undefined, ip?: string): Promise<AuthResult> {
    if (!token) throw new UnauthorizedException('Sessão expirada');

    const result = await this.refreshTokens.rotate(token);

    switch (result.kind) {
      case 'invalid':
        throw new UnauthorizedException('Sessão expirada');

      case 'race':
        // Outra aba renovou a sessão neste instante; o navegador já recebeu
        // o cookie novo. O front tenta de novo uma vez.
        throw new ConflictException('Sessão renovada por outra requisição');

      case 'reuse':
        // Um token já trocado voltou a ser usado: alguém tem uma cópia dele.
        // Encerra a sessão inteira, do atacante e da vítima.
        await this.prisma.$transaction(async (tx) => {
          await this.refreshTokens.revokeFamily(result.familyId, tx);
          await this.audit.record(
            {
              action: 'REFRESH_TOKEN_REUSE',
              userId: result.userId,
              metadata: { familyId: result.familyId },
              ip,
            },
            tx,
          );
        });
        throw new UnauthorizedException('Sessão encerrada por segurança');

      case 'rotated': {
        const user = await this.users.findById(result.userId);
        if (!user?.active) {
          await this.refreshTokens.revokeAllForUser(result.userId);
          throw new UnauthorizedException('Sessão expirada');
        }
        return this.buildResult(user, result.token);
      }
    }
  }

  /** Idempotente: sem cookie ou com cookie inválido, só não faz nada. */
  async logout(token: string | undefined, ip?: string): Promise<void> {
    if (!token) return;
    const found = await this.refreshTokens.findByToken(token);
    if (!found) return;

    await this.prisma.$transaction(async (tx) => {
      await this.refreshTokens.revokeFamily(found.familyId, tx);
      await this.audit.record(
        { action: 'LOGOUT', userId: found.userId, ip },
        tx,
      );
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip?: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Sessão inválida');
    assertDemoAccountUnlocked(
      user,
      this.config.get('DEMO_MODE', { infer: true }),
    );

    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      // 400, e não 401: um 401 faria o front achar que a sessão expirou.
      throw new BadRequestException('Senha atual incorreta');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      // tokenVersion + 1 invalida na hora os access tokens já emitidos.
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      await this.refreshTokens.revokeAllForUser(userId, tx);
      await this.audit.record(
        {
          action: 'PASSWORD_CHANGED',
          userId,
          entity: 'User',
          entityId: userId,
          ip,
        },
        tx,
      );
    });
  }

  /**
   * Conta as falhas de login do e-mail na janela configurada, a partir da
   * auditoria (que já registra cada falha). No banco, e não em memória: vale
   * depois de um reinício e com mais de uma instância da API. A janela curta
   * usa o índice de created_at, sem varrer a tabela.
   *
   * A tentativa bloqueada também vai para a auditoria (um ataque fica
   * visível), mas não entra na contagem: senão cada tentativa bloqueada
   * empurraria o fim do bloqueio para frente.
   */
  private async assertNotLockedOut(
    email: string,
    userId: string | undefined,
    ip: string | undefined,
  ): Promise<void> {
    const max = this.config.get('LOGIN_MAX_FAILURES', { infer: true });
    const windowMs = this.config.get('LOGIN_FAILURE_WINDOW_MS', {
      infer: true,
    });
    const since = new Date(Date.now() - windowMs);

    const [{ failures }] = await this.prisma.$queryRaw<{ failures: number }[]>`
      SELECT count(*)::int AS failures
      FROM audit_logs
      WHERE action = 'LOGIN_FAILED'
        AND metadata->>'email' = ${email}
        AND COALESCE(metadata->>'reason', '') <> 'TOO_MANY_ATTEMPTS'
        AND created_at > ${since}`;

    if (failures >= max) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        userId,
        metadata: { email, reason: 'TOO_MANY_ATTEMPTS' },
        ip,
      });
      throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async buildResult(
    user: User,
    refreshToken: string,
  ): Promise<AuthResult> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      ver: user.tokenVersion,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
      user: toPublicUser(user),
      refreshToken,
    };
  }
}
