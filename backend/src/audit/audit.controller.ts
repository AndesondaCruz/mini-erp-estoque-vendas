import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Paginated } from '../common/pagination/pagination.js';
import { AuditService } from './audit.service.js';
import {
  type AuditLogDto,
  AuditLogPageDto,
  ListAuditLogsQueryDto,
} from './dto/audit-log.dto.js';

// Só leitura: não há rota de edição nem de exclusão (risco 10 do plano), e o
// trigger do banco recusa UPDATE e DELETE mesmo vindos de fora da API.
@ApiTags('audit')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Apenas ADMIN' })
@Roles('ADMIN')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista a auditoria com filtros por usuário, ação, entidade e período',
  })
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiBadRequestResponse({ description: 'Filtro inválido ou from >= to' })
  list(@Query() query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogDto>> {
    return this.audit.list(query);
  }
}
