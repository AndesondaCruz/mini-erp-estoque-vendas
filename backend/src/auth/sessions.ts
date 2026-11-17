import type { Prisma } from '../generated/prisma/client.js';

type Db = Pick<Prisma.TransactionClient, 'refreshToken'>;

/**
 * Encerra todas as sessões do usuário (revoga os refresh tokens ativos).
 * Função solta, e não método de serviço, para ser usada tanto pelo módulo
 * de autenticação quanto pelo de usuários sem criar dependência circular.
 */
export async function revokeAllUserSessions(
  db: Db,
  userId: string,
): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
