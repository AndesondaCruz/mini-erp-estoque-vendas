import { Prisma } from '../../generated/prisma/client.js';

/**
 * Códigos de erro do Prisma que a API traduz para respostas HTTP.
 * - P2002: violação de UNIQUE (vira 409)
 * - P2003: violação de chave estrangeira, por exemplo apagar algo que ainda
 *   tem registros apontando para ele (vira 409)
 * - P2025: registro não encontrado num update/delete (vira 404)
 */
export type PrismaErrorCode = 'P2002' | 'P2003' | 'P2025';

export function isPrismaError(
  error: unknown,
  code: PrismaErrorCode,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
