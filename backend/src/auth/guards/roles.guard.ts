import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../audit/audit.service.js';
import type { Role } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../authenticated-user.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

// Só o que o guard lê da requisição do Express.
interface GuardRequest {
  user?: AuthenticatedUser;
  method?: string;
  ip?: string;
  route?: { path?: string };
}

/**
 * Guard global de autorização. Roda DEPOIS do JwtAuthGuard, que é quem
 * preenche request.user.
 *
 * Regra: negar por padrão. Uma rota só é acessível se declarar
 * @Public() ou @Roles(...) com pelo menos um papel.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Procura primeiro no método e depois na classe; o primeiro encontrado
    // vence. Por isso @Roles no método sobrescreve o @Roles da classe.
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const { user } = request;
    if (!user) {
      // Só acontece se a ordem dos guards for trocada por engano.
      throw new UnauthorizedException('Usuário não autenticado');
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (!required || required.length === 0) {
      // Esquecer de declarar o acesso é erro de quem escreveu a rota.
      // Bloquear é o lado seguro; o log avisa quem desenvolve.
      this.logger.warn(
        `Rota sem @Roles nem @Public: ${context.getClass().name}.${context.getHandler().name}`,
      );
      throw new ForbiddenException('Acesso não configurado para esta rota');
    }

    if (!required.includes(user.role)) {
      // Toda negação por papel é uma tentativa contra uma rota restrita (uma
      // rota aberta aos três papéis nunca chega aqui), então vai para a
      // auditoria. O 403 de rota mal configurada, acima, não vai: é erro de
      // quem escreveu a rota, não tentativa de acesso.
      await this.recordDenied(request, user, required);
      throw new ForbiddenException(
        'Seu perfil não tem permissão para esta ação',
      );
    }
    return true;
  }

  /**
   * Grava o acesso negado sem nunca impedir o 403: se a auditoria falhar,
   * o erro vai para o log e a resposta continua sendo negar (fail closed).
   */
  private async recordDenied(
    request: GuardRequest,
    user: AuthenticatedUser,
    required: Role[],
  ): Promise<void> {
    try {
      await this.audit.record({
        action: 'ACCESS_DENIED',
        userId: user.id,
        metadata: {
          method: request.method,
          // O padrão da rota (/api/v1/users/:id), não a URL: a query string
          // pode trazer termos de busca, que não pertencem à auditoria.
          route: request.route?.path ?? null,
          role: user.role,
          requiredRoles: required,
        },
        ip: request.ip,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao auditar acesso negado: ${(error as Error).message}`,
      );
    }
  }
}
