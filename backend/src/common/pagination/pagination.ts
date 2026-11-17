import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 100;

/**
 * Parâmetros comuns de listagem. A paginação é obrigatória (com padrão)
 * e tem limite: o cliente não consegue pedir a tabela inteira de uma vez.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number) // query string chega como texto: "2" -> 2
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 20;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function paginated<T>(
  data: T[],
  total: number,
  { page, pageSize }: Pick<PaginationQueryDto, 'page' | 'pageSize'>,
): Paginated<T> {
  return {
    data,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/** Converte page/pageSize em skip/take do Prisma. */
export function toSkipTake({
  page,
  pageSize,
}: Pick<PaginationQueryDto, 'page' | 'pageSize'>) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
