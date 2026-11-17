import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

/**
 * Declara quais papéis podem acessar a rota (no método ou na classe).
 * O RolesGuard lê esta lista. Rota sem @Roles e sem @Public é bloqueada.
 *
 *   @Roles('ADMIN', 'GERENTE')
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
