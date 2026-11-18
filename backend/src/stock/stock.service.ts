import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  type Paginated,
  paginated,
  toSkipTake,
} from '../common/pagination/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { StockMovementType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateStockMovementDto,
  ListStockMovementsQueryDto,
  StockMovementDto,
} from './dto/stock-movement.dto.js';

type Tx = Prisma.TransactionClient;

const WITH_REFS = {
  product: { select: { id: true, sku: true, name: true } },
  user: { select: { id: true, name: true } },
} as const;

type MovementWithRefs = Prisma.StockMovementGetPayload<{
  include: typeof WITH_REFS;
}>;

function toMovementDto(m: MovementWithRefs): StockMovementDto {
  return {
    id: m.id,
    product: m.product,
    type: m.type,
    quantity: m.quantity,
    balanceAfter: m.balanceAfter,
    reason: m.reason,
    user: m.user,
    createdAt: m.createdAt,
  };
}

interface MovementInput {
  productId: string;
  quantity: number;
  userId: string;
  reason?: string | null;
  /** Venda que originou a saída (ou o estorno, na Fase 5). */
  saleId?: string;
}

/** Resultado da baixa com os preços lidos no MESMO comando que baixou. */
export interface DecreaseResult {
  movement: MovementWithRefs;
  salePrice: Prisma.Decimal;
  costPrice: Prisma.Decimal;
}

/**
 * ÚNICO ponto do sistema que altera products.current_stock (risco 3 do
 * plano). Toda alteração de saldo grava a movimentação na mesma transação,
 * então saldo e histórico nunca divergem.
 *
 * Os métodos que recebem `tx` rodam dentro da transação de quem chama: a
 * venda (Fase 4) e o cancelamento (Fase 5) vão reaproveitá-los.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** POST /stock/movements: entrada, saída manual ou ajuste de inventário. */
  async register(
    actor: AuthenticatedUser,
    dto: CreateStockMovementDto,
    ip?: string,
  ): Promise<StockMovementDto> {
    if (dto.type === 'AJUSTE' && dto.quantity !== undefined) {
      throw new BadRequestException(
        'AJUSTE usa countedStock (o saldo contado), não quantity',
      );
    }
    if (dto.type !== 'AJUSTE' && dto.countedStock !== undefined) {
      throw new BadRequestException(
        `${dto.type} usa quantity, não countedStock`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const input = {
        productId: dto.productId,
        userId: actor.id,
        reason: dto.reason ?? null,
      };
      let movement: MovementWithRefs;
      if (dto.type === 'ENTRADA') {
        movement = await this.increase(tx, 'ENTRADA', {
          ...input,
          quantity: dto.quantity as number,
        });
      } else if (dto.type === 'SAIDA') {
        movement = await this.decrease(tx, {
          ...input,
          quantity: dto.quantity as number,
        });
      } else {
        movement = await this.adjust(tx, {
          ...input,
          countedStock: dto.countedStock as number,
        });
      }

      // Saída manual e ajuste são ações sensíveis (seção 3.2 do plano).
      if (dto.type !== 'ENTRADA') {
        await this.audit.record(
          {
            action:
              dto.type === 'SAIDA' ? 'STOCK_MANUAL_EXIT' : 'STOCK_ADJUSTED',
            userId: actor.id,
            entity: 'StockMovement',
            entityId: movement.id,
            after: {
              id: movement.id,
              productId: movement.productId,
              type: movement.type,
              quantity: movement.quantity,
              balanceAfter: movement.balanceAfter,
              reason: movement.reason,
            },
            ip,
          },
          tx,
        );
      }
      return toMovementDto(movement);
    });
  }

  /** Soma ao saldo (ENTRADA; ESTORNO na Fase 5). Vale para produto inativo. */
  async increase(
    tx: Tx,
    type: Extract<StockMovementType, 'ENTRADA' | 'ESTORNO'>,
    input: MovementInput,
  ): Promise<MovementWithRefs> {
    const rows = await tx.$queryRaw<{ current_stock: number }[]>`
      UPDATE products
      SET current_stock = current_stock + ${input.quantity}, updated_at = now()
      WHERE id = ${input.productId}::uuid
      RETURNING current_stock`;
    if (rows.length === 0) {
      throw new NotFoundException('Produto não encontrado');
    }
    return this.insertMovement(
      tx,
      type,
      input.quantity,
      rows[0].current_stock,
      input,
    );
  }

  /**
   * Baixa atômica e condicional (risco 1 do plano). A condição e a escrita
   * são UM comando: "subtrai só se houver saldo". Duas saídas simultâneas da
   * última unidade não passam as duas, porque o Postgres serializa os
   * UPDATEs na mesma linha: a segunda espera a primeira confirmar, relê o
   * saldo (já 0) e falha na condição. Nenhum lock explícito é necessário.
   */
  async decrease(tx: Tx, input: MovementInput): Promise<MovementWithRefs> {
    return (await this.decreaseReturningPrices(tx, input)).movement;
  }

  /**
   * A mesma baixa, devolvendo também preço de venda e custo. A venda usa
   * estes valores como snapshot (risco 6): como vêm do RETURNING do UPDATE
   * que travou a linha, ninguém consegue mudar o preço entre a leitura e o
   * fim da transação da venda.
   */
  async decreaseReturningPrices(
    tx: Tx,
    input: MovementInput,
  ): Promise<DecreaseResult> {
    const rows = await tx.$queryRaw<
      {
        current_stock: number;
        sale_price: Prisma.Decimal;
        cost_price: Prisma.Decimal;
      }[]
    >`
      UPDATE products
      SET current_stock = current_stock - ${input.quantity}, updated_at = now()
      WHERE id = ${input.productId}::uuid
        AND active
        AND current_stock >= ${input.quantity}
      RETURNING current_stock, sale_price, cost_price`;

    if (rows.length === 0) {
      // 0 linhas: descobrir o motivo só para responder com a mensagem certa.
      // A decisão (não baixar) já foi tomada pelo UPDATE acima.
      const product = await tx.product.findUnique({
        where: { id: input.productId },
        select: { active: true, currentStock: true },
      });
      if (!product) throw new NotFoundException('Produto não encontrado');
      if (!product.active) {
        throw new ConflictException('Produto inativo não pode ter saída');
      }
      throw new ConflictException({
        message: 'Estoque insuficiente',
        details: {
          productId: input.productId,
          requested: input.quantity,
          available: product.currentStock,
        },
      });
    }
    const movement = await this.insertMovement(
      tx,
      'SAIDA',
      -input.quantity,
      rows[0].current_stock,
      input,
    );
    return {
      movement,
      salePrice: rows[0].sale_price,
      costPrice: rows[0].cost_price,
    };
  }

  /**
   * Ajuste de inventário (risco 4 do plano): o gerente informa quanto
   * contou, e a diferença é calculada aqui, com a linha travada. Sem o lock,
   * uma venda entre "ler o saldo" e "gravar o contado" seria apagada.
   */
  async adjust(
    tx: Tx,
    input: Omit<MovementInput, 'quantity'> & { countedStock: number },
  ): Promise<MovementWithRefs> {
    const rows = await tx.$queryRaw<{ current_stock: number }[]>`
      SELECT current_stock FROM products
      WHERE id = ${input.productId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException('Produto não encontrado');
    }

    const delta = input.countedStock - rows[0].current_stock;
    if (delta === 0) {
      throw new BadRequestException(
        `O saldo já é ${input.countedStock}: não há diferença para ajustar`,
      );
    }

    await tx.$executeRaw`
      UPDATE products
      SET current_stock = ${input.countedStock}, updated_at = now()
      WHERE id = ${input.productId}::uuid`;
    return this.insertMovement(tx, 'AJUSTE', delta, input.countedStock, {
      ...input,
      quantity: delta,
    });
  }

  /** `productId` (do extrato) tem prioridade sobre o filtro da query. */
  async list(
    query: ListStockMovementsQueryDto,
    productId: string | undefined = query.productId,
  ): Promise<Paginated<StockMovementDto>> {
    const where: Prisma.StockMovementWhereInput = {
      ...(productId && { productId }),
      ...(query.type && { type: query.type }),
      ...(query.userId && { userId: query.userId }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lt: new Date(query.to) }),
        },
      }),
    };

    const [total, movements] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: WITH_REFS,
        // Desempate por id: movimentações no mesmo milissegundo ficam estáveis.
        orderBy: [{ createdAt: query.order }, { id: query.order }],
        ...toSkipTake(query),
      }),
    ]);
    return paginated(movements.map(toMovementDto), total, query);
  }

  /** Extrato de um produto: 404 se o produto não existe. */
  async listForProduct(
    productId: string,
    query: ListStockMovementsQueryDto,
  ): Promise<Paginated<StockMovementDto>> {
    const exists = await this.prisma.product.count({
      where: { id: productId },
    });
    if (!exists) throw new NotFoundException('Produto não encontrado');
    return this.list(query, productId);
  }

  private insertMovement(
    tx: Tx,
    type: StockMovementType,
    quantity: number,
    balanceAfter: number,
    input: MovementInput,
  ): Promise<MovementWithRefs> {
    return tx.stockMovement.create({
      data: {
        productId: input.productId,
        type,
        quantity,
        balanceAfter,
        reason: input.reason ?? null,
        saleId: input.saleId ?? null,
        userId: input.userId,
      },
      include: WITH_REFS,
    });
  }
}
