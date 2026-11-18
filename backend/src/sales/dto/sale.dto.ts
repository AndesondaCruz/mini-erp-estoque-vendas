import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.js';
import { SaleStatus } from '../../generated/prisma/enums.js';
import { MAX_STOCK } from '../../products/dto/product.dto.js';

export const MAX_SALE_ITEMS = 50;

/**
 * Só produto e quantidade. Preço não entra: o servidor lê o preço atual do
 * banco (risco 6). Enviar unitPrice responde 400 (forbidNonWhitelisted).
 */
export class SaleItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_STOCK })
  @IsInt({ message: 'quantity deve ser um número inteiro' })
  @Min(1)
  @Max(MAX_STOCK)
  quantity!: number;
}

export class CreateSaleDto {
  @ApiProperty({ type: [SaleItemInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'a venda precisa de pelo menos um item' })
  @ArrayMaxSize(MAX_SALE_ITEMS)
  // Produto repetido é recusado (risco 2 do plano): some as quantidades
  // numa linha só. Isso também evita violar o UNIQUE (sale_id, product_id).
  @ArrayUnique((item: SaleItemInputDto) => item.productId, {
    message: 'o mesmo produto aparece em mais de um item',
  })
  @ValidateNested({ each: true })
  @Type(() => SaleItemInputDto)
  items!: SaleItemInputDto[];
}

export const SALE_SORT_FIELDS = ['createdAt', 'number', 'total'] as const;
export type SaleSortField = (typeof SALE_SORT_FIELDS)[number];

export class ListSalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SaleStatus })
  @IsOptional()
  @IsIn(Object.values(SaleStatus))
  status?: SaleStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Ignorado para VENDEDOR, que só vê as próprias vendas',
  })
  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @ApiPropertyOptional({
    description: 'Início do período (inclusivo), ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Fim do período (exclusivo), ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: SALE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SALE_SORT_FIELDS)
  sort: SaleSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override order: 'asc' | 'desc' = 'desc';
}

class RefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

class ProductRefDto extends RefDto {
  @ApiProperty() sku!: string;
}

export class SaleItemDto {
  @ApiProperty({ type: ProductRefDto }) product!: ProductRefDto;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: '5.50' }) unitPrice!: string;
  @ApiPropertyOptional({
    example: '3.20',
    description: 'Ausente na resposta para VENDEDOR',
  })
  unitCost?: string;
  @ApiProperty({ example: '11.00' }) subtotal!: string;
}

export class SaleDto {
  @ApiProperty() id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ type: RefDto }) seller!: RefDto;
  @ApiProperty({ enum: SaleStatus }) status!: SaleStatus;
  @ApiProperty({ example: '11.00' }) total!: string;
  @ApiProperty({ type: [SaleItemDto] }) items!: SaleItemDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: Date, nullable: true }) canceledAt!: Date | null;
  @ApiProperty({ type: RefDto, nullable: true }) canceledBy!: RefDto | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason!: string | null;
}
