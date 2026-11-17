import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.js';
import { IsCnpj, normalizeCnpj } from '../../common/validation/cnpj.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Campos opcionais aceitam null: no PATCH, null apaga o valor e
 * undefined (campo ausente) mantém o que está gravado.
 */
export class CreateSupplierDto {
  @ApiProperty({ example: 'Distribuidora Sertão', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'nome é obrigatório' })
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: '12.ABC.345/01DE-35',
    nullable: true,
    description: 'CNPJ numérico ou alfanumérico, com ou sem máscara',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCnpj(value) : value,
  )
  @IsCnpj()
  document?: string | null;

  @ApiPropertyOptional({ example: '(84) 3333-4444', nullable: true })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[0-9()+\-\s]{8,20}$/, {
    message:
      'phone deve ter de 8 a 20 caracteres entre números, ( ) + - e espaço',
  })
  phone?: string | null;

  @ApiPropertyOptional({ example: 'vendas@sertao.com', nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email inválido' })
  @MaxLength(254)
  email?: string | null;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiPropertyOptional({ description: 'true reativa um fornecedor desativado' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export const SUPPLIER_SORT_FIELDS = ['name', 'createdAt'] as const;
export type SupplierSortField = (typeof SUPPLIER_SORT_FIELDS)[number];

export class ListSuppliersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou CNPJ' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'active deve ser true ou false' })
  active?: boolean;

  @ApiPropertyOptional({ enum: SUPPLIER_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(SUPPLIER_SORT_FIELDS)
  sort: SupplierSortField = 'name';
}

export class SupplierDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) document!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty() active!: boolean;
}
