import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.js';
import { StockMovementType } from '../../generated/prisma/enums.js';
import { MAX_STOCK } from '../../products/dto/product.dto.js';

// ESTORNO não entra aqui: só o cancelamento de venda (Fase 5) gera estorno.
export const MANUAL_MOVEMENT_TYPES = ['ENTRADA', 'SAIDA', 'AJUSTE'] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

/**
 * Um corpo por tipo:
 * - ENTRADA e SAIDA: `quantity` (quanto entra ou sai, sempre positivo).
 * - AJUSTE: `countedStock` (quanto foi contado na prateleira). O servidor
 *   calcula a diferença sob lock, para uma venda simultânea não a invalidar.
 * Mandar o campo do outro tipo responde 400 (conferido no service).
 */
export class CreateStockMovementDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ enum: MANUAL_MOVEMENT_TYPES })
  @IsIn(MANUAL_MOVEMENT_TYPES, {
    message: 'type deve ser ENTRADA, SAIDA ou AJUSTE',
  })
  type!: ManualMovementType;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_STOCK,
    description: 'Obrigatório em ENTRADA e SAIDA',
  })
  @ValidateIf((o: CreateStockMovementDto) => o.type !== 'AJUSTE')
  @IsInt({ message: 'quantity deve ser um número inteiro' })
  @Min(1)
  @Max(MAX_STOCK)
  quantity?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_STOCK,
    description: 'Obrigatório em AJUSTE: o saldo contado',
  })
  @ValidateIf((o: CreateStockMovementDto) => o.type === 'AJUSTE')
  @IsInt({ message: 'countedStock deve ser um número inteiro' })
  @Min(0)
  @Max(MAX_STOCK)
  countedStock?: number;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Obrigatório em SAIDA e AJUSTE',
  })
  @ValidateIf(
    (o: CreateStockMovementDto) =>
      o.type !== 'ENTRADA' || o.reason !== undefined,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'reason é obrigatório em SAIDA e AJUSTE' })
  @MinLength(1, { message: 'reason é obrigatório em SAIDA e AJUSTE' })
  @MaxLength(255)
  reason?: string;
}

export class ListStockMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @IsIn(Object.values(StockMovementType))
  type?: StockMovementType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Responsável' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00-03:00',
    description: 'Início do período (inclusivo), ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-01T00:00:00-03:00',
    description: 'Fim do período (exclusivo), ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  // Extrato: o mais recente primeiro, por padrão.
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override order: 'asc' | 'desc' = 'desc';
}

class ProductRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
}

class UserRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class StockMovementDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: ProductRefDto }) product!: ProductRefDto;
  @ApiProperty({ enum: StockMovementType }) type!: StockMovementType;
  @ApiProperty({ description: 'Com sinal: negativo é saída' })
  quantity!: number;
  @ApiProperty() balanceAfter!: number;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: UserRefDto }) user!: UserRefDto;
  @ApiProperty() createdAt!: Date;
}
