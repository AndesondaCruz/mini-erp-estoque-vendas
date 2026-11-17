import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Paginated,
  paginated,
  toSkipTake,
} from '../common/pagination/pagination.js';
import { isPrismaError } from '../common/prisma/prisma-errors.js';
import { normalizeCnpj } from '../common/validation/cnpj.js';
import type { Prisma, Supplier } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierDto,
  UpdateSupplierDto,
} from './dto/supplier.dto.js';

function toSupplierDto(supplier: Supplier): SupplierDto {
  const { id, name, document, phone, email, active } = supplier;
  return { id, name, document, phone, email, active };
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSuppliersQueryDto): Promise<Paginated<SupplierDto>> {
    const search = query.search?.trim();
    // Quem busca por CNPJ pode digitar com máscara: "11.222" acha "11222...".
    const document = search ? normalizeCnpj(search) : '';
    const where: Prisma.SupplierWhereInput = {
      ...(query.active !== undefined && { active: query.active }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          ...(document ? [{ document: { contains: document } }] : []),
        ],
      }),
    };

    const [total, suppliers] = await this.prisma.$transaction([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
    ]);
    return paginated(suppliers.map(toSupplierDto), total, query);
  }

  async findOne(id: string): Promise<SupplierDto> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    return toSupplierDto(supplier);
  }

  async create(dto: CreateSupplierDto): Promise<SupplierDto> {
    try {
      const supplier = await this.prisma.supplier.create({
        data: {
          name: dto.name,
          document: dto.document ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
        },
      });
      return toSupplierDto(supplier);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<SupplierDto> {
    const hasChanges = Object.values(dto).some((value) => value !== undefined);
    if (!hasChanges)
      throw new BadRequestException('Nenhum campo para atualizar');

    try {
      const supplier = await this.prisma.supplier.update({
        where: { id },
        // Campo a campo (proteção contra mass assignment).
        // undefined = não altera; null = apaga o valor.
        data: {
          name: dto.name,
          document: dto.document,
          phone: dto.phone,
          email: dto.email,
          active: dto.active,
        },
      });
      return toSupplierDto(supplier);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * DELETE desativa em vez de apagar: na Fase 2b os produtos passam a
   * apontar para o fornecedor, e o histórico precisa continuar legível.
   * Desativar duas vezes não é erro (operação idempotente).
   */
  async deactivate(id: string): Promise<void> {
    try {
      await this.prisma.supplier.update({
        where: { id },
        data: { active: false },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): unknown {
    if (isPrismaError(error, 'P2002')) {
      return new ConflictException('CNPJ já cadastrado');
    }
    if (isPrismaError(error, 'P2025')) {
      return new NotFoundException('Fornecedor não encontrado');
    }
    return error;
  }
}
