import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { formatMoney } from '../common/money/money.js';
import {
  type Paginated,
  paginated,
  toSkipTake,
} from '../common/pagination/pagination.js';
import { isPrismaError } from '../common/prisma/prisma-errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from '../stock/stock.service.js';
import type {
  CreateSaleDto,
  ListSalesQueryDto,
  SaleDto,
  SaleItemInputDto,
} from './dto/sale.dto.js';

const WITH_DETAILS = {
  seller: { select: { id: true, name: true } },
  canceledBy: { select: { id: true, name: true } },
  items: {
    include: { product: { select: { id: true, sku: true, name: true } } },
    orderBy: { productId: 'asc' },
  },
} as const satisfies Prisma.SaleInclude;

type SaleWithDetails = Prisma.SaleGetPayload<{ include: typeof WITH_DETAILS }>;

/** O VENDEDOR não vê o custo dos itens (mesma regra do costPrice do produto). */
export function toSaleDto(
  sale: SaleWithDetails,
  role: AuthenticatedUser['role'],
): SaleDto {
  return {
    id: sale.id,
    number: sale.number,
    seller: sale.seller,
    status: sale.status,
    total: formatMoney(sale.total),
    items: sale.items.map((item) => ({
      product: item.product,
      quantity: item.quantity,
      unitPrice: formatMoney(item.unitPrice),
      ...(role !== 'VENDEDOR' && { unitCost: formatMoney(item.unitCost) }),
      subtotal: formatMoney(item.subtotal),
    })),
    createdAt: sale.createdAt,
    canceledAt: sale.canceledAt,
    canceledBy: sale.canceledBy,
    cancelReason: sale.cancelReason,
  };
}

/** Ordem fixa de travamento: toda venda trava os produtos na mesma ordem. */
export function sortByProductId<T extends { productId: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) =>
    a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
  );
}

export interface CreateSaleResult {
  sale: SaleDto;
  /** false quando a chave de idempotência devolveu uma venda já existente. */
  created: boolean;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    idempotencyKey: string,
    dto: CreateSaleDto,
    ip?: string,
  ): Promise<CreateSaleResult> {
    // Caminho rápido do retry: a venda já existe, nada é baixado de novo.
    const existing = await this.findByKey(idempotencyKey);
    if (existing) return this.replay(existing, actor, dto);

    try {
      const sale = await this.prisma.$transaction(async (tx) => {
        // 1) A venda é gravada PRIMEIRO. Duas requisições com a mesma chave
        //    disputam o índice único aqui: a segunda espera a primeira e
        //    falha (P2002) antes de tocar no estoque.
        const { id: saleId } = await tx.sale.create({
          data: { sellerId: actor.id, idempotencyKey },
          select: { id: true },
        });

        // 2) Ordem fixa por productId: elimina o deadlock entre uma venda
        //    de [A, B] e outra de [B, A] (risco 2).
        let total = new Prisma.Decimal(0);
        for (const item of sortByProductId(dto.items)) {
          // 3) Baixa atômica (risco 1). Preço e custo vêm do mesmo comando
          //    que baixou e travou a linha (risco 6).
          const { salePrice, costPrice } =
            await this.stock.decreaseReturningPrices(tx, {
              productId: item.productId,
              quantity: item.quantity,
              userId: actor.id,
              saleId,
            });
          const subtotal = salePrice.times(item.quantity);
          await tx.saleItem.create({
            data: {
              saleId,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: salePrice,
              unitCost: costPrice,
              subtotal,
            },
          });
          total = total.plus(subtotal);
        }

        const saved = await tx.sale.update({
          where: { id: saleId },
          data: { total },
          include: WITH_DETAILS,
        });
        await this.audit.record(
          {
            action: 'SALE_CREATED',
            userId: actor.id,
            entity: 'Sale',
            entityId: saved.id,
            after: {
              id: saved.id,
              number: saved.number,
              sellerId: saved.sellerId,
              total: formatMoney(saved.total),
              status: saved.status,
              items: saved.items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                unitPrice: formatMoney(i.unitPrice),
              })),
            },
            ip,
          },
          tx,
        );
        return saved;
      });
      return { sale: toSaleDto(sale, actor.role), created: true };
    } catch (error) {
      // Outra requisição com a mesma chave venceu a corrida. Esta transação
      // foi desfeita por inteiro (inclusive as baixas): devolve a vencedora.
      if (isPrismaError(error, 'P2002')) {
        const winner = await this.findByKey(idempotencyKey);
        if (winner) return this.replay(winner, actor, dto);
      }
      if (isPrismaError(error, 'P2020')) {
        throw new BadRequestException('O total da venda excede o limite');
      }
      throw error;
    }
  }

  async list(
    actor: AuthenticatedUser,
    query: ListSalesQueryDto,
  ): Promise<Paginated<SaleDto>> {
    // "Só as próprias" vem do token, nunca de parâmetro do cliente (risco 8).
    const sellerId = actor.role === 'VENDEDOR' ? actor.id : query.sellerId;
    const where: Prisma.SaleWhereInput = {
      ...(sellerId && { sellerId }),
      ...(query.status && { status: query.status }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lt: new Date(query.to) }),
        },
      }),
    };

    const [total, sales] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        include: WITH_DETAILS,
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
    ]);
    return paginated(
      sales.map((s) => toSaleDto(s, actor.role)),
      total,
      query,
    );
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<SaleDto> {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: WITH_DETAILS,
    });
    // Venda de outro vendedor responde 404, e não 403: o 403 confirmaria
    // que aquele id existe (IDOR, risco 8).
    if (!sale || (actor.role === 'VENDEDOR' && sale.sellerId !== actor.id)) {
      throw new NotFoundException('Venda não encontrada');
    }
    return toSaleDto(sale, actor.role);
  }

  private findByKey(idempotencyKey: string): Promise<SaleWithDetails | null> {
    return this.prisma.sale.findUnique({
      where: { idempotencyKey },
      include: WITH_DETAILS,
    });
  }

  /**
   * Retry legítimo: mesma chave, mesmo vendedor, mesmos itens -> devolve a
   * venda existente. Qualquer diferença é erro do cliente (chave reutilizada),
   * e não um retry: 409, sem criar nada.
   */
  private replay(
    sale: SaleWithDetails,
    actor: AuthenticatedUser,
    dto: CreateSaleDto,
  ): CreateSaleResult {
    if (sale.sellerId !== actor.id || !sameItems(sale, dto.items)) {
      throw new ConflictException(
        'Idempotency-Key já usada em outra venda; gere uma chave nova',
      );
    }
    return { sale: toSaleDto(sale, actor.role), created: false };
  }
}

function sameItems(
  sale: SaleWithDetails,
  items: readonly SaleItemInputDto[],
): boolean {
  if (sale.items.length !== items.length) return false;
  const saved = new Map(sale.items.map((i) => [i.productId, i.quantity]));
  return items.every((i) => saved.get(i.productId) === i.quantity);
}
