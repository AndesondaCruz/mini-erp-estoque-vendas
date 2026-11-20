import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.js';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  type AuditAction,
  type AuditEntity,
} from '../audit.types.js';

// A auditoria só ordena por data: é uma linha do tempo. Mesmo assim a lista de
// campos permitidos existe, como em todas as listagens (o valor da URL nunca
// vira nome de coluna diretamente).
export const AUDIT_SORT_FIELDS = ['createdAt'] as const;
export type AuditSortField = (typeof AUDIT_SORT_FIELDS)[number];

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Quem executou a ação' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AUDIT_ENTITIES })
  @IsOptional()
  @IsIn(AUDIT_ENTITIES)
  entity?: AuditEntity;

  @ApiPropertyOptional({ description: 'Id do registro afetado' })
  @IsOptional()
  @IsString()
  @MaxLength(64) // tamanho da coluna entity_id
  entityId?: string;

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

  @ApiPropertyOptional({ enum: AUDIT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(AUDIT_SORT_FIELDS)
  sort: AuditSortField = 'createdAt';

  // Uma linha do tempo de auditoria se lê do mais recente para o mais antigo.
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override order: 'asc' | 'desc' = 'desc';
}

class AuditUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
}

type Json = Record<string, unknown>;

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({ enum: AUDIT_ACTIONS }) action!: string;

  @ApiProperty({
    type: AuditUserDto,
    nullable: true,
    description: 'Nulo em login com e-mail inexistente',
  })
  user!: AuditUserDto | null;

  @ApiProperty({ type: String, nullable: true, enum: AUDIT_ENTITIES })
  entity!: string | null;

  @ApiProperty({ type: String, nullable: true }) entityId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Estado anterior (só os campos permitidos da entidade)',
  })
  before!: Json | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Estado posterior (só os campos permitidos da entidade)',
  })
  after!: Json | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Json | null;

  @ApiProperty({ type: String, nullable: true }) ip!: string | null;

  @ApiProperty() createdAt!: Date;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogDto] }) data!: AuditLogDto[];

  @ApiProperty({
    example: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  })
  meta!: { page: number; pageSize: number; total: number; totalPages: number };
}
