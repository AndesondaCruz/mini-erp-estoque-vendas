import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../authenticated-user.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

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

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Procura primeiro no método e depois na classe; o primeiro encontrado
    // vence. Por isso @Roles no método sobrescreve o @Roles da classe.
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
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
      throw new ForbiddenException(
        'Seu perfil não tem permissão para esta ação',
      );
    }
    return true;
  }
}
