import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Paginated } from '../common/pagination/pagination.js';
import {
  CreateStockMovementDto,
  ListStockMovementsQueryDto,
  StockMovementDto,
} from './dto/stock-movement.dto.js';
import { StockService } from './stock.service.js';

// Movimentações e histórico: só ADMIN e GERENTE (matriz, seção 4 do plano).
@ApiTags('stock')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Apenas ADMIN e GERENTE' })
@Roles('ADMIN', 'GERENTE')
@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('stock/movements')
  @ApiOperation({
    summary: 'Registra entrada, saída manual ou ajuste de inventário',
    description:
      'ENTRADA e SAIDA: quantity. AJUSTE: countedStock (o saldo contado). SAIDA e AJUSTE exigem reason.',
  })
  @ApiCreatedResponse({ type: StockMovementDto })
  @ApiBadRequestResponse({
    description: 'Dados inválidos ou ajuste sem diferença',
  })
  @ApiNotFoundResponse({ description: 'Produto não encontrado' })
  @ApiConflictResponse({
    description: 'Estoque insuficiente (details.available) ou produto inativo',
  })
  register(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateStockMovementDto,
    @Ip() ip: string,
  ): Promise<StockMovementDto> {
    return this.stock.register(actor, dto, ip);
  }

  @Get('stock/movements')
  @ApiOperation({
    summary: 'Histórico de movimentações com filtros e paginação',
  })
  list(
    @Query() query: ListStockMovementsQueryDto,
  ): Promise<Paginated<StockMovementDto>> {
    return this.stock.list(query);
  }

  @Get('products/:id/movements')
  @ApiTags('products')
  @ApiOperation({ summary: 'Extrato de movimentações de um produto' })
  @ApiNotFoundResponse({ description: 'Produto não encontrado' })
  listForProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListStockMovementsQueryDto,
  ): Promise<Paginated<StockMovementDto>> {
    return this.stock.listForProduct(id, query);
  }
}
