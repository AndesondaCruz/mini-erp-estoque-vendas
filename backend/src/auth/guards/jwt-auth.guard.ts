import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UsersService } from '../../users/users.service.js';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../authenticated-user.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Guard global: toda rota exige um access token válido, exceto as @Public().
 *
 * O papel e o status do usuário são lidos do banco a cada requisição.
 * Custo: uma consulta por chave primária. Ganho: desativar um usuário,
 * trocar o papel ou a senha vale na hora, e não só quando o token expirar.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException('Token de acesso ausente');

    let payload: AccessTokenPayload;
    try {
      // O algoritmo é fixado: um token com "alg": "none" ou outro algoritmo
      // é recusado, mesmo que a biblioteca aceitasse por padrão.
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Token de acesso inválido ou expirado');
    }

    const user =
      typeof payload.sub === 'string'
        ? await this.users.findById(payload.sub)
        : null;
    if (!user || !user.active || user.tokenVersion !== payload.ver) {
      throw new UnauthorizedException('Sessão inválida');
    }

    request.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    return true;
  }

  private extractBearer(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token ? token : undefined;
  }
}
