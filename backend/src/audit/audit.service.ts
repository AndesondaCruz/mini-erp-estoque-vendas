import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type Paginated,
  paginated,
  toSkipTake,
} from '../common/pagination/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AuditLogDto,
  ListAuditLogsQueryDto,
} from './dto/audit-log.dto.js';
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

  /** Lista a auditoria com filtros, do mais recente para o mais antigo. */
  async list(query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogDto>> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException('from deve ser anterior a to');
    }

    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId && { userId: query.userId }),
      ...(query.action && { action: query.action }),
      ...(query.entity && { entity: query.entity }),
      ...(query.entityId && { entityId: query.entityId }),
      ...((from || to) && {
        createdAt: { ...(from && { gte: from }), ...(to && { lt: to }) },
      }),
    };

    const [total, logs] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        // `sort` já foi validado contra a lista de campos permitidos.
        // O id desempata registros do mesmo milissegundo: sem ele, um registro
        // poderia aparecer em duas páginas (ou em nenhuma).
        orderBy: [{ [query.sort]: query.order }, { id: query.order }],
        ...toSkipTake(query),
      }),
    ]);

    return paginated(
      logs.map((log) => ({
        id: log.id,
        action: log.action,
        user: log.user,
        entity: log.entity,
        entityId: log.entityId,
        before: log.before as Record<string, unknown> | null,
        after: log.after as Record<string, unknown> | null,
        metadata: log.metadata as Record<string, unknown> | null,
        ip: log.ip,
        createdAt: log.createdAt,
      })),
      total,
      query,
    );
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
