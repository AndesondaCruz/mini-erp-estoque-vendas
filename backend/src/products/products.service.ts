import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuditAction } from '../audit/audit.types.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { formatMoney, toDecimal } from '../common/money/money.js';
import {
  type Paginated,
  paginated,
  toSkipTake,
} from '../common/pagination/pagination.js';
import { isPrismaError } from '../common/prisma/prisma-errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ProductDto,
  UpdateProductDto,
} from './dto/product.dto.js';

type Tx = Prisma.TransactionClient;

const WITH_REFS = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} as const;

type ProductWithRefs = Prisma.ProductGetPayload<{ include: typeof WITH_REFS }>;

/**
 * Formato da resposta por papel. O VENDEDOR não recebe costPrice: a chave
 * nem existe no objeto (não é null nem undefined), então não aparece no JSON.
 * Esconder só no front não basta: qualquer um leria o campo pela API.
 */
export function toProductDto(
  product: ProductWithRefs,
  role: AuthenticatedUser['role'],
): ProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    supplier: product.supplier,
    ...(role !== 'VENDEDOR' && { costPrice: formatMoney(product.costPrice) }),
    salePrice: formatMoney(product.salePrice),
    minStock: product.minStock,
    currentStock: product.currentStock,
    lowStock: product.currentStock <= product.minStock,
    active: product.active,
  };
}

/** Campos que vão para a auditoria. Preços como texto, iguais aos da API. */
function auditSnapshot(product: ProductWithRefs): Record<string, unknown> {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    costPrice: formatMoney(product.costPrice),
    salePrice: formatMoney(product.salePrice),
    active: product.active,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListProductsQueryDto,
  ): Promise<Paginated<ProductDto>> {
    const search = query.search?.trim();
    // VENDEDOR só enxerga o que pode vender: produtos ativos, sempre.
    const active = actor.role === 'VENDEDOR' ? true : query.active;
    const minStock = this.prisma.product.fields.minStock;

    const where: Prisma.ProductWhereInput = {
      ...(active !== undefined && { active }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.supplierId && { supplierId: query.supplierId }),
      // Compara duas colunas da mesma linha, no banco: current_stock <= min_stock.
      ...(query.lowStock === true && { currentStock: { lte: minStock } }),
      ...(query.lowStock === false && { currentStock: { gt: minStock } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search.toUpperCase() } },
        ],
      }),
    };

    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: WITH_REFS,
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
    ]);
    return paginated(
      products.map((p) => toProductDto(p, actor.role)),
      total,
      query,
    );
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: WITH_REFS,
    });
    // Para o VENDEDOR, produto inativo é como se não existisse.
    if (!product || (actor.role === 'VENDEDOR' && !product.active)) {
      throw new NotFoundException('Produto não encontrado');
    }
    return toProductDto(product, actor.role);
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateProductDto,
    ip?: string,
  ): Promise<ProductDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.supplierId) await this.assertActiveSupplier(tx, dto.supplierId);

        const product = await tx.product.create({
          data: {
            sku: dto.sku,
            name: dto.name,
            categoryId: dto.categoryId,
            supplierId: dto.supplierId ?? null,
            costPrice: toDecimal(dto.costPrice),
            salePrice: toDecimal(dto.salePrice),
            minStock: dto.minStock ?? 0,
          },
          include: WITH_REFS,
        });
        await this.audit.record(
          {
            action: 'PRODUCT_CREATED',
            userId: actor.id,
            entity: 'Product',
            entityId: product.id,
            after: auditSnapshot(product),
            ip,
          },
          tx,
        );
        return toProductDto(product, actor.role);
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
    ip?: string,
  ): Promise<ProductDto> {
    if (dto.active !== undefined && actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Só o ADMIN pode ativar ou desativar produtos',
      );
    }
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('Nenhum campo para atualizar');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Trava a linha ANTES de ler. Sem isso, dois gerentes mudando o preço
        // ao mesmo tempo leriam o mesmo "antes", e a auditoria de um deles
        // apagaria a mudança do outro do histórico (10 -> 12 e 10 -> 15, em
        // vez de 10 -> 12 -> 15).
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
        const current = await tx.product.findUnique({
          where: { id },
          include: WITH_REFS,
        });
        if (!current) throw new NotFoundException('Produto não encontrado');

        if (dto.supplierId && dto.supplierId !== current.supplierId) {
          await this.assertActiveSupplier(tx, dto.supplierId);
        }

        const updated = await tx.product.update({
          where: { id },
          // Campo a campo (proteção contra mass assignment).
          data: {
            sku: dto.sku,
            name: dto.name,
            categoryId: dto.categoryId,
            supplierId: dto.supplierId,
            costPrice:
              dto.costPrice === undefined
                ? undefined
                : toDecimal(dto.costPrice),
            salePrice:
              dto.salePrice === undefined
                ? undefined
                : toDecimal(dto.salePrice),
            minStock: dto.minStock,
            active: dto.active,
          },
          include: WITH_REFS,
        });

        const priceChanged =
          !current.costPrice.equals(updated.costPrice) ||
          !current.salePrice.equals(updated.salePrice);
        if (priceChanged) {
          await this.recordChange(
            tx,
            'PRODUCT_PRICE_CHANGED',
            actor,
            current,
            updated,
            ip,
          );
        }
        if (current.active !== updated.active) {
          const action = updated.active
            ? 'PRODUCT_REACTIVATED'
            : 'PRODUCT_DEACTIVATED';
          await this.recordChange(tx, action, actor, current, updated, ip);
        }
        return toProductDto(updated, actor.role);
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  /**
   * DELETE desativa (só ADMIN, garantido pelo @Roles da rota). Produto tem
   * histórico de vendas e movimentações, então nunca é apagado de verdade.
   * Desativar um produto já inativo não é erro e não gera auditoria.
   */
  async deactivate(
    actor: AuthenticatedUser,
    id: string,
    ip?: string,
  ): Promise<void> {
    await this.update(actor, id, { active: false }, ip);
  }

  private async assertActiveSupplier(
    tx: Tx,
    supplierId: string,
  ): Promise<void> {
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { active: true },
    });
    if (!supplier) throw new BadRequestException('Fornecedor não encontrado');
    if (!supplier.active) {
      throw new BadRequestException('Fornecedor inativo');
    }
  }

  private recordChange(
    tx: Tx,
    action: AuditAction,
    actor: AuthenticatedUser,
    before: ProductWithRefs,
    after: ProductWithRefs,
    ip?: string,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        userId: actor.id,
        entity: 'Product',
        entityId: after.id,
        before: auditSnapshot(before),
        after: auditSnapshot(after),
        ip,
      },
      tx,
    );
  }

  private mapWriteError(error: unknown): unknown {
    if (isPrismaError(error, 'P2002')) {
      return new ConflictException('SKU já cadastrado');
    }
    // Num INSERT/UPDATE, P2003 significa "a categoria (ou o fornecedor)
    // informado não existe": é dado inválido do cliente (400), e não
    // conflito (409) como no DELETE de categoria.
    if (isPrismaError(error, 'P2003')) {
      return new BadRequestException('Categoria ou fornecedor não encontrado');
    }
    if (isPrismaError(error, 'P2025')) {
      return new NotFoundException('Produto não encontrado');
    }
    return error;
  }
}
