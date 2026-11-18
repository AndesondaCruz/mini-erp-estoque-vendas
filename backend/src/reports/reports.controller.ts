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
import {
  type Paginated,
  PaginationQueryDto,
} from '../common/pagination/pagination.js';
import {
  SalesReportDto,
  SalesReportQueryDto,
  StockAlertDto,
  StockValueDto,
  TopProductDto,
  TopProductsQueryDto,
} from './dto/report.dto.js';
import { ReportsService } from './reports.service.js';

// Relatórios: ADMIN e GERENTE. Alertas de estoque: todos (sem custo).
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Papel sem permissão' })
@Roles('ADMIN', 'GERENTE')
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/sales')
  @ApiTags('reports')
  @ApiOperation({
    summary: 'Vendas por período (só concluídas), no fuso da loja',
    description:
      'Períodos sem venda aparecem zerados. from e to são datas inclusivas (AAAA-MM-DD), no máximo 366 dias.',
  })
  @ApiOkResponse({ type: SalesReportDto })
  @ApiBadRequestResponse({ description: 'Período inválido' })
  sales(@Query() query: SalesReportQueryDto): Promise<SalesReportDto> {
    return this.reports.sales(query);
  }

  @Get('reports/top-products')
  @ApiTags('reports')
  @ApiOperation({
    summary: 'Produtos mais vendidos no período (só concluídas)',
  })
  @ApiOkResponse({ type: [TopProductDto] })
  @ApiBadRequestResponse({ description: 'Período inválido' })
  topProducts(@Query() query: TopProductsQueryDto): Promise<TopProductDto[]> {
    return this.reports.topProducts(query);
  }

  @Get('reports/stock-value')
  @ApiTags('reports')
  @ApiOperation({
    summary: 'Valor do estoque a custo e a preço de venda, por categoria',
  })
  @ApiOkResponse({ type: StockValueDto })
  stockValue(): Promise<StockValueDto> {
    return this.reports.stockValue();
  }

  @Get('stock/alerts')
  @Roles('ADMIN', 'GERENTE', 'VENDEDOR')
  @ApiTags('stock')
  @ApiOperation({
    summary: 'Produtos ativos com saldo menor ou igual ao mínimo',
    description: 'Ordenado pela maior falta. Sem custo: o VENDEDOR também vê.',
  })
  stockAlerts(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<StockAlertDto>> {
    return this.reports.stockAlerts(query);
  }
}
