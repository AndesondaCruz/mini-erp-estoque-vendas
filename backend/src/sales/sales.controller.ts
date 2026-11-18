import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Paginated } from '../common/pagination/pagination.js';
import { CreateSaleDto, ListSalesQueryDto, SaleDto } from './dto/sale.dto.js';
import { IdempotencyKey } from './idempotency-key.decorator.js';
import { SalesService } from './sales.service.js';

// Registrar e consultar: todos os papéis. O VENDEDOR só enxerga as próprias
// vendas (filtro no service). Cancelamento entra na Fase 5.
@ApiTags('sales')
@ApiBearerAuth()
@Roles('ADMIN', 'GERENTE', 'VENDEDOR')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @ApiOperation({
    summary: 'Registra uma venda com vários itens',
    description:
      'Baixa o estoque de todos os itens numa transação. Preços vêm do banco. Repetir com a mesma Idempotency-Key devolve a venda já criada (200).',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID gerado pelo cliente a cada tentativa de venda',
  })
  @ApiCreatedResponse({ type: SaleDto, description: 'Venda criada' })
  @ApiOkResponse({ type: SaleDto, description: 'Retry: venda já existente' })
  @ApiBadRequestResponse({ description: 'Dados inválidos ou header ausente' })
  @ApiNotFoundResponse({ description: 'Produto não encontrado' })
  @ApiConflictResponse({
    description:
      'Estoque insuficiente (details), produto inativo ou chave reutilizada',
  })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: CreateSaleDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaleDto> {
    const { sale, created } = await this.sales.create(
      actor,
      idempotencyKey,
      dto,
      ip,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return sale;
  }

  @Get()
  @ApiOperation({
    summary: 'Lista vendas (VENDEDOR: só as próprias)',
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListSalesQueryDto,
  ): Promise<Paginated<SaleDto>> {
    return this.sales.list(actor, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma venda' })
  @ApiOkResponse({ type: SaleDto })
  @ApiNotFoundResponse({
    description: 'Não existe, ou é de outro vendedor (para VENDEDOR)',
  })
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SaleDto> {
    return this.sales.findOne(actor, id);
  }
}
