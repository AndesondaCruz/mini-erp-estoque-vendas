/**
 * Especificação do RolesGuard, escrita ANTES da implementação.
 *
 * Contrato esperado:
 *   - src/auth/decorators/roles.decorator.ts exporta `Roles(...roles: Role[])`
 *   - src/auth/guards/roles.guard.ts exporta a classe `RolesGuard`,
 *     com o construtor `constructor(reflector: Reflector, audit: AuditService)`
 *   - `canActivate` é assíncrono: a negação por papel é gravada na auditoria
 *     antes do 403 (Fase 9c).
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
import type { AuditService } from '../../audit/audit.service.js';
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
  const request = {
    user,
    method: 'GET',
    ip: '10.0.0.7',
    route: { path: '/api/v1/teste/:id' },
  };
  return {
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const record = vi.fn();
  const guard = new RolesGuard(new Reflector(), {
    record,
  } as unknown as AuditService);

  beforeEach(() => {
    record.mockReset();
    record.mockResolvedValue(undefined);
  });

  describe('rota com @Roles no método', () => {
    it('libera quem tem um dos papéis exigidos', async () => {
      await expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'ADMIN'),
        ),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'GERENTE'),
        ),
      ).resolves.toBe(true);
    });

    it('bloqueia com 403 quem não tem nenhum dos papéis', async () => {
      await expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'VENDEDOR'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('libera os três papéis quando todos estão listados', async () => {
      for (const role of ['ADMIN', 'GERENTE', 'VENDEDOR'] as const) {
        await expect(
          guard.canActivate(
            contextFor(SemRolesNaClasse, 'qualquerPapel', role),
          ),
        ).resolves.toBe(true);
      }
    });
  });

  describe('@Roles na classe', () => {
    it('vale para os métodos sem @Roles próprio', async () => {
      await expect(
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'herdaDaClasse', 'ADMIN'),
        ),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'herdaDaClasse', 'GERENTE'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('o @Roles do método tem prioridade sobre o da classe', async () => {
      await expect(
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'sobrescreveNoMetodo', 'GERENTE'),
        ),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(
          contextFor(ApenasAdminNaClasse, 'sobrescreveNoMetodo', 'ADMIN'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('negar por padrão', () => {
    it('rota sem @Roles e sem @Public é bloqueada, mesmo para ADMIN', async () => {
      await expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'esqueceuDeDeclarar', 'ADMIN'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('@Roles() com lista vazia é tratado como erro de configuração: bloqueia', async () => {
      await expect(
        guard.canActivate(contextFor(SemRolesNaClasse, 'listaVazia', 'ADMIN')),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('rota pública', () => {
    it('libera sem exigir usuário', async () => {
      await expect(
        guard.canActivate(contextFor(SemRolesNaClasse, 'publica')),
      ).resolves.toBe(true);
    });
  });

  describe('sem usuário na requisição', () => {
    // Não deveria acontecer (o JwtAuthGuard roda antes), mas se a ordem dos
    // guards for trocada por engano, o RolesGuard não pode liberar.
    it('rota protegida sem request.user responde 401', async () => {
      await expect(
        guard.canActivate(contextFor(SemRolesNaClasse, 'adminOuGerente')),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('auditoria do acesso negado', () => {
    it('grava ACCESS_DENIED com o padrão da rota, o papel e os papéis exigidos', async () => {
      await expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'VENDEDOR'),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(record).toHaveBeenCalledExactlyOnceWith({
        action: 'ACCESS_DENIED',
        userId: 'u1',
        metadata: {
          method: 'GET',
          route: '/api/v1/teste/:id',
          role: 'VENDEDOR',
          requiredRoles: ['ADMIN', 'GERENTE'],
        },
        ip: '10.0.0.7',
      });
    });

    it('se a auditoria falhar, continua respondendo 403 (nunca libera)', async () => {
      record.mockRejectedValue(new Error('banco fora do ar'));

      await expect(
        guard.canActivate(
          contextFor(SemRolesNaClasse, 'adminOuGerente', 'VENDEDOR'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('não grava acesso liberado, rota pública nem rota mal configurada', async () => {
      await guard.canActivate(
        contextFor(SemRolesNaClasse, 'adminOuGerente', 'ADMIN'),
      );
      await guard.canActivate(contextFor(SemRolesNaClasse, 'publica'));
      await guard
        .canActivate(
          contextFor(SemRolesNaClasse, 'esqueceuDeDeclarar', 'ADMIN'),
        )
        .catch(() => undefined);

      expect(record).not.toHaveBeenCalled();
    });
  });
});
