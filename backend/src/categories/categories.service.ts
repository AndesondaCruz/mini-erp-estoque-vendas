import {
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
import type { Category, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CategoryDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto.js';

function toCategoryDto({ id, name }: Category): CategoryDto {
  return { id, name };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCategoriesQueryDto): Promise<Paginated<CategoryDto>> {
    const search = query.search?.trim();
    const where: Prisma.CategoryWhereInput = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : {};

    const [total, categories] = await this.prisma.$transaction([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
    ]);
    return paginated(categories.map(toCategoryDto), total, query);
  }

  async create(dto: CreateCategoryDto): Promise<CategoryDto> {
    try {
      const category = await this.prisma.category.create({
        data: { name: dto.name },
      });
      return toCategoryDto(category);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryDto> {
    try {
      const category = await this.prisma.category.update({
        where: { id },
        data: { name: dto.name },
      });
      return toCategoryDto(category);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Exclusão física: categoria não tem histórico próprio. Quem impede apagar
   * uma categoria com produtos é a chave estrangeira (ON DELETE RESTRICT), e
   * não uma consulta antes: entre "consultar" e "apagar", outro usuário
   * poderia cadastrar um produto nela.
   */
  async remove(id: string): Promise<void> {
    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): unknown {
    if (isPrismaError(error, 'P2002')) {
      return new ConflictException('Já existe uma categoria com esse nome');
    }
    if (isPrismaError(error, 'P2003')) {
      return new ConflictException(
        'A categoria tem produtos vinculados e não pode ser excluída',
      );
    }
    if (isPrismaError(error, 'P2025')) {
      return new NotFoundException('Categoria não encontrada');
    }
    return error;
  }
}
