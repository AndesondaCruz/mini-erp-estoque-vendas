/**
 * Especificação do RolesGuard, escrita ANTES da implementação.
 *
 * Contrato esperado:
 *   - src/auth/decorators/roles.decorator.ts exporta `Roles(...roles: Role[])`
 *   - src/auth/guards/roles.guard.ts exporta a classe `RolesGuard`,
 *     com o construtor `constructor(reflector: Reflector)`
 *
 * Os testes usam decorators de verdade num controller de mentira e o
 * Reflector real do Nest: o que importa é o comportamento, não como
 * você guarda os metadados por dentro.
 */
import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../authenticated-user.js';
import { Public } from '../decorators/public.decorator.js';
import { Roles } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

// Controller de mentira, só para pendurar os decorators.
@Roles('ADMIN')
class ApenasAdminNaClasse {
  herdaDaClasse() {}

  @Roles('GERENTE')
  sobrescreveNoMetodo() {}
}

class SemRolesNaClasse {
  @Roles('ADMIN', 'GERENTE')
  adminOuGerente() {}

  @Roles('ADMIN', 'GERENTE', 'VENDEDOR')
  qualquerPapel() {}

  @Public()
  publica() {}

  esqueceuDeDeclarar() {}

  @Roles()
  listaVazia() {}
}

function contextFor(
  controller: new () => object,
  method: string,
  role?: Role,
): ExecutionContext {
  const user: AuthenticatedUser | undefined = role
    ? { id: 'u1', name: 'Teste', email: 't@loja.com', role }
    : undefined;
  return {
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  describe('rota com @Roles no método', () => {
    it('libera quem tem um dos papéis exigidos', () => {
      expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'ADMIN'),
        ),
      ).toBe(true);
      expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'GERENTE'),
        ),
      ).toBe(true);
    });

    it('bloqueia com 403 quem não tem nenhum dos papéis', () => {
      expect(() =>
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'VENDEDOR'),
        ),
      ).toThrow(ForbiddenException);
    });

    it('libera os três papéis quando todos estão listados', () => {
      for (const role of ['ADMIN', 'GERENTE', 'VENDEDOR'] as const) {
        expect(
          guard.canActivate(
            contextFor(SemRolesNaClasse, 'qualquerPapel', role),
          ),
        ).toBe(true);
      }
    });
  });

  describe('@Roles na classe', () => {
    it('vale para os métodos sem @Roles próprio', () => {
      expect(
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'herdaDaClasse', 'ADMIN'),
        ),
      ).toBe(true);
      expect(() =>
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'herdaDaClasse', 'GERENTE'),
        ),
      ).toThrow(ForbiddenException);
    });

    it('o @Roles do método tem prioridade sobre o da classe', () => {
      expect(
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'sobrescreveNoMetodo', 'GERENTE'),
        ),
      ).toBe(true);
      expect(() =>
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'sobrescreveNoMetodo', 'ADMIN'),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('negar por padrão', () => {
    it('rota sem @Roles e sem @Public é bloqueada, mesmo para ADMIN', () => {
      expect(() =>
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'esqueceuDeDeclarar', 'ADMIN'),
        ),
      ).toThrow(ForbiddenException);
    });

    it('@Roles() com lista vazia é tratado como erro de configuração: bloqueia', () => {
      expect(() =>
        guard.canActivate(contextFor(SemRolesNaClasse, 'listaVazia', 'ADMIN')),
      ).toThrow(ForbiddenException);
    });
  });

  describe('rota pública', () => {
    it('libera sem exigir usuário', () => {
      expect(guard.canActivate(contextFor(SemRolesNaClasse, 'publica'))).toBe(
        true,
      );
    });
  });

  describe('sem usuário na requisição', () => {
    // Não deveria acontecer (o JwtAuthGuard roda antes), mas se a ordem dos
    // guards for trocada por engano, o RolesGuard não pode liberar.
    it('rota protegida sem request.user responde 401', () => {
      expect(() =>
        guard.canActivate(contextFor(SemRolesNaClasse, 'adminOuGerente')),
      ).toThrow(UnauthorizedException);
    });
  });
});
