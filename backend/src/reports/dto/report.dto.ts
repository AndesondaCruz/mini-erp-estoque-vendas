import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Datas de calendário no fuso da loja (REPORTS_TIMEZONE), as duas inclusivas. */
export class DateRangeQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'AAAA-MM-DD, inclusivo' })
  @IsString()
  from!: string;

  @ApiProperty({ example: '2026-11-30', description: 'AAAA-MM-DD, inclusivo' })
  @IsString()
  to!: string;
}

export const GROUP_BY = ['day', 'week', 'month'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export class SalesReportQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: GROUP_BY,
    default: 'day',
    description: 'week começa na segunda-feira (ISO)',
  })
  @IsOptional()
  @IsIn(GROUP_BY)
  groupBy: GroupBy = 'day';
}

export const MAX_TOP_PRODUCTS = 50;

export class TopProductsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: MAX_TOP_PRODUCTS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TOP_PRODUCTS)
  limit: number = 10;
}

export class SalesReportRowDto {
  @ApiProperty({ example: '2026-11-17', description: 'Início do período' })
  period!: string;
  @ApiProperty() sales!: number;
  @ApiProperty({ example: '150.00' }) revenue!: string;
}

export class SalesReportDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ enum: GROUP_BY }) groupBy!: GroupBy;
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: [SalesReportRowDto] }) rows!: SalesReportRowDto[];
  @ApiProperty() totalSales!: number;
  @ApiProperty({ example: '1500.00' }) totalRevenue!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '25.00',
    description: 'null quando não há vendas',
  })
  averageTicket!: string | null;
}

export class TopProductDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: '55.00' }) revenue!: string;
}

export class StockValueCategoryDto {
  @ApiProperty() categoryId!: string;
  @ApiProperty() categoryName!: string;
  @ApiProperty({ description: 'Produtos com saldo' }) products!: number;
  @ApiProperty({ description: 'Dos quais desativados' })
  inactiveProducts!: number;
  @ApiProperty() units!: number;
  @ApiProperty({ example: '320.00' }) costValue!: string;
  @ApiProperty({ example: '550.00' }) saleValue!: string;
}

export class StockValueDto {
  @ApiProperty({ type: [StockValueCategoryDto] })
  categories!: StockValueCategoryDto[];
  @ApiProperty() totalUnits!: number;
  @ApiProperty({ example: '320.00' }) totalCostValue!: string;
  @ApiProperty({ example: '550.00' }) totalSaleValue!: string;
}

export class StockAlertDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() category!: { id: string; name: string };
  @ApiProperty() currentStock!: number;
  @ApiProperty() minStock!: number;
  @ApiProperty({ description: 'minStock - currentStock' }) shortage!: number;
}
