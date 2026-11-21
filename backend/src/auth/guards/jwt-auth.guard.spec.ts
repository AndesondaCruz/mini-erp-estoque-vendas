import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { User } from '../../generated/prisma/client.js';
import type { UsersService } from '../../users/users.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const activeUser: User = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@loja.com',
  passwordHash: '$argon2id$hash',
  role: 'VENDEDOR',
  active: true,
  tokenVersion: 3,
  isDemo: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(options: { isPublic?: boolean; authorization?: string } = {}) {
  const request: Record<string, unknown> = {
    headers: { authorization: options.authorization },
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(options.isPublic ?? false),
  };
  const jwt = { verifyAsync: vi.fn() };
  const users = { findById: vi.fn() };
  const guard = new JwtAuthGuard(
    reflector as unknown as Reflector,
    jwt as unknown as JwtService,
    users as unknown as UsersService,
  );
  return { guard, context, request, jwt, users };
}

describe('JwtAuthGuard', () => {
  it('libera rota pública sem olhar o token', async () => {
    const { guard, context, jwt } = setup({ isPublic: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('sem cabeçalho Authorization: 401', async () => {
    const { guard, context } = setup();
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Token de acesso ausente',
    );
  });

  it('esquema diferente de Bearer: 401', async () => {
    const { guard, context } = setup({ authorization: 'Basic abc' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token inválido ou expirado: 401, e só aceita HS256', async () => {
    const { guard, context, jwt } = setup({ authorization: 'Bearer xyz' });
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Token de acesso inválido ou expirado',
    );
    expect(jwt.verifyAsync).toHaveBeenCalledWith('xyz', {
      algorithms: ['HS256'],
    });
  });

  it.each([
    ['usuário não existe mais', null],
    ['usuário desativado', { ...activeUser, active: false }],
    [
      'senha trocada depois da emissão (versão antiga)',
      { ...activeUser, tokenVersion: 4 },
    ],
  ])('%s: 401', async (_caso, found) => {
    const { guard, context, jwt, users } = setup({
      authorization: 'Bearer ok',
    });
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', ver: 3 });
    users.findById.mockResolvedValue(found);

    await expect(guard.canActivate(context)).rejects.toThrow('Sessão inválida');
  });

  it('token válido: preenche request.user com papel lido do banco', async () => {
    const { guard, context, request, jwt, users } = setup({
      authorization: 'Bearer ok',
    });
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', ver: 3 });
    users.findById.mockResolvedValue(activeUser);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'u1',
      name: 'Ana',
      email: 'ana@loja.com',
      role: 'VENDEDOR',
    });
  });
});
