import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AUDITABLE_FIELDS,
  type AuditEntity,
  type AuditEntry,
} from './audit.types.js';

// Client do Prisma ou de uma transação: ambos têm o model auditLog.
type DbClient = Pick<Prisma.TransactionClient, 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava um registro de auditoria.
   * Ao auditar uma ação que altera dados, passe o client da transação (`tx`):
   * assim a ação e a auditoria são gravadas juntas, ou nenhuma das duas.
   */
  async record(entry: AuditEntry, db: DbClient = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        before: this.sanitize(entry.entity, entry.before),
        after: this.sanitize(entry.entity, entry.after),
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
        ip: entry.ip?.slice(0, 64) ?? null,
      },
    });
  }

  /** Mantém só os campos permitidos para a entidade. */
  sanitize(
    entity: AuditEntity | undefined,
    data: Record<string, unknown> | undefined,
  ): Prisma.InputJsonObject | undefined {
    if (!data || !entity) return undefined;
    const allowed: readonly string[] = AUDITABLE_FIELDS[entity];
    return Object.fromEntries(
      Object.entries(data).filter(([key]) => allowed.includes(key)),
    ) as Prisma.InputJsonObject;
  }
}
