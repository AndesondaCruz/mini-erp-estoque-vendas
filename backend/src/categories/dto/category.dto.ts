import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Bebidas', maxLength: 80 })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'nome é obrigatório' })
  @MaxLength(80)
  name!: string;
}

// Categoria só tem o nome: editar é trocar o nome.
export class UpdateCategoryDto extends CreateCategoryDto {}

export const CATEGORY_SORT_FIELDS = ['name', 'createdAt'] as const;
export type CategorySortField = (typeof CATEGORY_SORT_FIELDS)[number];

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @ApiPropertyOptional({ enum: CATEGORY_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(CATEGORY_SORT_FIELDS)
  sort: CategorySortField = 'name';
}

export class CategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
