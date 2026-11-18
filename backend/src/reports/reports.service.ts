import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatMoney } from '../common/money/money.js';
import {
  type Paginated,
  paginated,
  type PaginationQueryDto,
} from '../common/pagination/pagination.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertDateRange } from './date-range.js';
import type {
  SalesReportDto,
  SalesReportQueryDto,
  StockAlertDto,
  StockValueDto,
  TopProductDto,
  TopProductsQueryDto,
} from './dto/report.dto.js';

/**
 * Relatórios: agregações feitas no SQL, nunca em memória.
 *
 * Fuso (risco 11): tudo é gravado em UTC (timestamptz). O período chega em
 * datas de calendário da loja e vira um intervalo UTC no SQL:
 *   início = from 00:00 no fuso da loja
 *   fim    = (to + 1 dia) 00:00 no fuso da loja (exclusivo)
 * e o agrupamento por dia/semana/mês também é feito no fuso da loja.
 *
 * Valores variáveis (datas, fuso, groupBy, limit) vão como parâmetros do
 * template tagged do Prisma, nunca concatenados no SQL.
 *
 * Só vendas CONCLUIDA entram: uma venda cancelada some dos números.
 */
@Injectable()
export class ReportsService {
  private readonly timezone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.timezone = config.get('REPORTS_TIMEZONE', { infer: true });
  }

  async sales(query: SalesReportQueryDto): Promise<SalesReportDto> {
    assertDateRange(query.from, query.to);
    const { from, to, groupBy } = query;
    const tz = this.timezone;

    // generate_series cria todos os períodos do intervalo; o LEFT JOIN
    // deixa zerados os que não tiveram venda (o gráfico não pula dias).
    const rows = await this.prisma.$queryRaw<
      { period: string; sales: number; revenue: Prisma.Decimal }[]
    >`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${groupBy}::text, ${from}::date::timestamp),
          date_trunc(${groupBy}::text, ${to}::date::timestamp),
          ('1 ' || ${groupBy}::text)::interval
        ) AS bucket
      ),
      totals AS (
        SELECT date_trunc(${groupBy}::text, s.created_at AT TIME ZONE ${tz}::text) AS bucket,
               count(*)::int AS sales,
               sum(s.total) AS revenue
        FROM sales s
        WHERE s.status = 'CONCLUIDA'
          AND s.created_at >= (${from}::date::timestamp AT TIME ZONE ${tz}::text)
          AND s.created_at <  ((${to}::date + 1)::timestamp AT TIME ZONE ${tz}::text)
        GROUP BY 1
      )
      SELECT to_char(b.bucket, 'YYYY-MM-DD') AS period,
             COALESCE(t.sales, 0)::int AS sales,
             COALESCE(t.revenue, 0) AS revenue
      FROM buckets b
      LEFT JOIN totals t ON t.bucket = b.bucket
      ORDER BY b.bucket`;

    const totalSales = rows.reduce((sum, r) => sum + r.sales, 0);
    const totalRevenue = rows.reduce(
      (sum, r) => sum.plus(r.revenue),
      new Prisma.Decimal(0),
    );
    return {
      from,
      to,
      groupBy,
      timezone: tz,
      rows: rows.map((r) => ({
        period: r.period,
        sales: r.sales,
        revenue: formatMoney(new Prisma.Decimal(r.revenue)),
      })),
      totalSales,
      totalRevenue: formatMoney(totalRevenue),
      averageTicket:
        totalSales === 0
          ? null
          : formatMoney(totalRevenue.dividedBy(totalSales)),
    };
  }

  async topProducts(query: TopProductsQueryDto): Promise<TopProductDto[]> {
    assertDateRange(query.from, query.to);
    const { from, to, limit } = query;
    const tz = this.timezone;

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        sku: string;
        name: string;
        quantity: number;
        revenue: Prisma.Decimal;
      }[]
    >`
      SELECT p.id, p.sku, p.name,
             sum(i.quantity)::int AS quantity,
             sum(i.subtotal) AS revenue
      FROM sale_items i
      JOIN sales s ON s.id = i.sale_id
      JOIN products p ON p.id = i.product_id
      WHERE s.status = 'CONCLUIDA'
        AND s.created_at >= (${from}::date::timestamp AT TIME ZONE ${tz}::text)
        AND s.created_at <  ((${to}::date + 1)::timestamp AT TIME ZONE ${tz}::text)
      GROUP BY p.id, p.sku, p.name
      ORDER BY quantity DESC, revenue DESC, p.id
      LIMIT ${limit}`;

    return rows.map((r) => ({
      ...r,
      revenue: formatMoney(new Prisma.Decimal(r.revenue)),
    }));
  }

  /**
   * Valor do estoque por categoria, a custo e a preço de venda. Conta todos
   * os produtos com saldo, inclusive desativados: a mercadoria continua
   * fisicamente na loja.
   */
  async stockValue(): Promise<StockValueDto> {
    const rows = await this.prisma.$queryRaw<
      {
        category_id: string;
        category_name: string;
        products: number;
        inactive_products: number;
        units: bigint;
        cost_value: Prisma.Decimal;
        sale_value: Prisma.Decimal;
      }[]
    >`
      SELECT c.id AS category_id,
             c.name::text AS category_name,
             count(*)::int AS products,
             count(*) FILTER (WHERE NOT p.active)::int AS inactive_products,
             sum(p.current_stock)::bigint AS units,
             sum(p.current_stock * p.cost_price) AS cost_value,
             sum(p.current_stock * p.sale_price) AS sale_value
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.current_stock > 0
      GROUP BY c.id, c.name
      ORDER BY cost_value DESC, c.name`;

    const zero = new Prisma.Decimal(0);
    const totalCost = rows.reduce((s, r) => s.plus(r.cost_value), zero);
    const totalSale = rows.reduce((s, r) => s.plus(r.sale_value), zero);
    return {
      categories: rows.map((r) => ({
        categoryId: r.category_id,
        categoryName: r.category_name,
        products: r.products,
        inactiveProducts: r.inactive_products,
        units: Number(r.units),
        costValue: formatMoney(new Prisma.Decimal(r.cost_value)),
        saleValue: formatMoney(new Prisma.Decimal(r.sale_value)),
      })),
      totalUnits: rows.reduce((s, r) => s + Number(r.units), 0),
      totalCostValue: formatMoney(totalCost),
      totalSaleValue: formatMoney(totalSale),
    };
  }

  /**
   * Alerta de estoque mínimo (risco 13): calculado na consulta, nunca
   * guardado, então nunca fica desatualizado. Só produtos ativos, e sem
   * custo na resposta (o VENDEDOR também acessa).
   */
  async stockAlerts(
    query: PaginationQueryDto,
  ): Promise<Paginated<StockAlertDto>> {
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM products
      WHERE active AND current_stock <= min_stock`;

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        sku: string;
        name: string;
        category_id: string;
        category_name: string;
        current_stock: number;
        min_stock: number;
      }[]
    >`
      SELECT p.id, p.sku, p.name, c.id AS category_id, c.name::text AS category_name,
             p.current_stock, p.min_stock
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.active AND p.current_stock <= p.min_stock
      ORDER BY (p.min_stock - p.current_stock) DESC, p.name, p.id
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;

    return paginated(
      rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        category: { id: r.category_id, name: r.category_name },
        currentStock: r.current_stock,
        minStock: r.min_stock,
        shortage: r.min_stock - r.current_stock,
      })),
      total,
      query,
    );
  }
}
