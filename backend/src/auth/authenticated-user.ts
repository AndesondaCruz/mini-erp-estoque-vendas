import type { Role } from '../generated/prisma/client.js';

// O que fica em request.user depois do JwtAuthGuard.
// Papel e status vêm do banco a cada requisição, não do token.
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AccessTokenPayload {
  sub: string;
  // Versão do usuário quando o token foi emitido (User.tokenVersion).
  ver: number;
}
