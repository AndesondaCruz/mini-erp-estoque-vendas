import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { PasswordService } from './password.service.js';
import type { RefreshTokenService } from './refresh-token.service.js';

const user: User = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@loja.com',
  passwordHash: '$argon2id$hash',
  role: 'GERENTE',
  active: true,
  tokenVersion: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup() {
  const tx = { user: { update: vi.fn() } };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const users = { findByEmail: vi.fn(), findById: vi.fn() };
  const passwords = {
    verify: vi.fn(),
    verifyAgainstDummy: vi.fn().mockResolvedValue(false),
    hash: vi.fn().mockResolvedValue('$argon2id$novo'),
    needsRehash: vi.fn().mockReturnValue(false),
  };
  const refreshTokens = {
    issue: vi.fn().mockResolvedValue({ id: 'rt1', token: 'refresh-novo' }),
    rotate: vi.fn(),
    revokeFamily: vi.fn(),
    revokeAllForUser: vi.fn(),
    findByToken: vi.fn(),
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('access-token') };
  const audit = { record: vi.fn() };
  const config = { get: vi.fn().mockReturnValue(900) };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    passwords as unknown as PasswordService,
    refreshTokens as unknown as RefreshTokenService,
    jwt as unknown as JwtService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, tx, users, passwords, refreshTokens, jwt, audit };
}

describe('AuthService', () => {
  describe('login', () => {
    it('e-mail inexistente: gasta o tempo de um hash, audita e responde 401 genérico', async () => {
      const { service, users, passwords, audit } = setup();
      users.findByEmail.mockResolvedValue(null);

      await expect(service.login('x@loja.com', 'senha')).rejects.toThrow(
        new UnauthorizedException('Credenciais inválidas'),
      );
      expect(passwords.verifyAgainstDummy).toHaveBeenCalledWith('senha');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LOGIN_FAILED',
          metadata: { email: 'x@loja.com', reason: 'UNKNOWN_EMAIL' },
        }),
      );
    });

    it('senha errada: mesma mensagem e nenhuma sessão criada', async () => {
      const { service, users, passwords, refreshTokens } = setup();
      users.findByEmail.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(false);

      await expect(service.login(user.email, 'errada')).rejects.toThrow(
        'Credenciais inválidas',
      );
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('usuário inativo: verifica a senha mesmo assim (tempo igual) e recusa', async () => {
      const { service, users, passwords, audit } = setup();
      users.findByEmail.mockResolvedValue({ ...user, active: false });
      passwords.verify.mockResolvedValue(true);

      await expect(service.login(user.email, 'certa')).rejects.toThrow(
        'Credenciais inválidas',
      );
      expect(passwords.verify).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { reason: 'INACTIVE_USER' } }),
      );
    });

    it('sucesso: token com a versão do usuário, sessão nova e auditoria na transação', async () => {
      const { service, tx, users, passwords, jwt, audit } = setup();
      users.findByEmail.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(true);

      const result = await service.login(user.email, 'certa', '10.0.0.1');

      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', ver: 2 });
      expect(result).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-novo',
        user: { id: 'u1', role: 'GERENTE' },
      });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(audit.record).toHaveBeenCalledWith(
        { action: 'LOGIN_SUCCESS', userId: 'u1', ip: '10.0.0.1' },
        tx,
      );
    });

    it('atualiza o hash quando os parâmetros do argon2 mudaram', async () => {
      const { service, tx, users, passwords } = setup();
      users.findByEmail.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(true);
      passwords.needsRehash.mockReturnValue(true);

      await service.login(user.email, 'certa');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: '$argon2id$novo' },
      });
    });
  });

  describe('refresh', () => {
    it('sem token: 401', async () => {
      const { service } = setup();
      await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('corrida entre abas: 409, sem revogar nada', async () => {
      const { service, refreshTokens } = setup();
      refreshTokens.rotate.mockResolvedValue({ kind: 'race' });

      await expect(service.refresh('t')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
    });

    it('reuso: revoga a família, audita e responde 401', async () => {
      const { service, refreshTokens, audit, tx } = setup();
      refreshTokens.rotate.mockResolvedValue({
        kind: 'reuse',
        userId: 'u1',
        familyId: 'f1',
      });

      await expect(service.refresh('t', '1.2.3.4')).rejects.toThrow(
        'Sessão encerrada por segurança',
      );
      expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('f1', tx);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REFRESH_TOKEN_REUSE',
          userId: 'u1',
        }),
        tx,
      );
    });

    it('usuário desativado depois do login: revoga as sessões e responde 401', async () => {
      const { service, refreshTokens, users } = setup();
      refreshTokens.rotate.mockResolvedValue({
        kind: 'rotated',
        userId: 'u1',
        token: 'novo',
      });
      users.findById.mockResolvedValue({ ...user, active: false });

      await expect(service.refresh('t')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    });
  });

  describe('changePassword', () => {
    it('senha atual errada: 400 (não 401, que o front leria como sessão expirada)', async () => {
      const { service, users, passwords } = setup();
      users.findById.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.changePassword('u1', 'errada', 'nova-senha-123'),
      ).rejects.toThrow(new BadRequestException('Senha atual incorreta'));
    });

    it('nova senha igual à atual: 400', async () => {
      const { service, users, passwords } = setup();
      users.findById.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(true);

      await expect(
        service.changePassword('u1', 'mesma-senha', 'mesma-senha'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sucesso: incrementa tokenVersion e revoga todas as sessões na mesma transação', async () => {
      const { service, tx, users, passwords, refreshTokens } = setup();
      users.findById.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(true);

      await service.changePassword('u1', 'antiga', 'nova-senha-123');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          passwordHash: '$argon2id$novo',
          tokenVersion: { increment: 1 },
        },
      });
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1', tx);
    });
  });
});
