import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsMoney } from '../../common/money/money.js';
import { PaginationQueryDto } from '../../common/pagination/pagination.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export const MAX_STOCK = 1_000_000;

/**
 * currentStock não aparece aqui de propósito: o saldo só muda por
 * movimentação de estoque (Fase 3). Como a validação global usa
 * forbidNonWhitelisted, enviar currentStock responde 400.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'CER-350', description: 'Gravado em maiúsculas' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9.-]{0,39}$/, {
    message:
      'sku deve ter até 40 caracteres entre letras, números, hífen e ponto',
  })
  sku!: string;

  @ApiProperty({ example: 'Cerveja lata 350 ml', maxLength: 160 })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'nome é obrigatório' })
  @MaxLength(160)
  name!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;

  @ApiProperty({ example: '3.20', description: 'Texto com até 2 casas' })
  @IsMoney()
  costPrice!: string;

  @ApiProperty({ example: '5.50', description: 'Texto com até 2 casas' })
  @IsMoney()
  salePrice!: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: MAX_STOCK })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  minStock?: number;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional({
    description: 'Só ADMIN. true reativa; para desativar use DELETE.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export const PRODUCT_SORT_FIELDS = [
  'name',
  'sku',
  'salePrice',
  'currentStock',
  'createdAt',
] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true: só produtos com saldo menor ou igual ao mínimo',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'lowStock deve ser true ou false' })
  lowStock?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Ignorado para VENDEDOR, que só vê produtos ativos',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'active deve ser true ou false' })
  active?: boolean;

  @ApiPropertyOptional({ enum: PRODUCT_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(PRODUCT_SORT_FIELDS)
  sort: ProductSortField = 'name';
}

class RefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class ProductDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: RefDto }) category!: RefDto;
  @ApiProperty({ type: RefDto, nullable: true }) supplier!: RefDto | null;
  @ApiPropertyOptional({
    example: '3.20',
    description: 'Ausente na resposta para VENDEDOR',
  })
  costPrice?: string;
  @ApiProperty({ example: '5.50' }) salePrice!: string;
  @ApiProperty() minStock!: number;
  @ApiProperty() currentStock!: number;
  @ApiProperty() lowStock!: boolean;
  @ApiProperty() active!: boolean;
}
