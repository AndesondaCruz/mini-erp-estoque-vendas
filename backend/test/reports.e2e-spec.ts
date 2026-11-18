import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createUser,
  DEFAULT_PASSWORD,
  resetDatabase,
} from './helpers.js';

// Os testes assumem o fuso padrão America/Fortaleza (UTC-3, sem horário de verão).
describe('Relatórios e alertas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = {} as Record<Role, string>;

  const http = () => request(app.getHttpServer());
  const as = (role: Role) => ({ Authorization: `Bearer ${tokens[role]}` });

  async function category(name = 'Geral') {
    return prisma.category.create({ data: { name } });
  }

  async function product(opts: {
    categoryId: string;
    stock?: number;
    salePrice?: string;
    costPrice?: string;
    minStock?: number;
    name?: string;
  }) {
    const p = await prisma.product.create({
      data: {
        sku: `SKU-${crypto.randomUUID().slice(0, 8)}`.toUpperCase(),
        name: opts.name ?? 'Produto',
        categoryId: opts.categoryId,
        salePrice: opts.salePrice ?? '10.00',
        costPrice: opts.costPrice ?? '4.00',
        minStock: opts.minStock ?? 0,
      },
    });
    if (opts.stock) {
      await http()
        .post('/api/v1/stock/movements')
        .set(as('GERENTE'))
        .send({ productId: p.id, type: 'ENTRADA', quantity: opts.stock })
        .expect(201);
    }
    return p;
  }

  /** Vende e posiciona a venda num instante exato (ISO com fuso). */
  async function saleAt(
    at: string,
    items: { productId: string; quantity: number }[],
  ) {
    const res = await http()
      .post('/api/v1/sales')
      .set(as('VENDEDOR'))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ items })
      .expect(201);
    await prisma.$executeRaw`UPDATE sales SET created_at = ${new Date(at)} WHERE id = ${res.body.id}::uuid`;
    return res.body as { id: string };
  }

  const salesReport = (qs: string, role: Role = 'GERENTE') =>
    http().get(`/api/v1/reports/sales?${qs}`).set(as(role));

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    for (const role of ['ADMIN', 'GERENTE', 'VENDEDOR'] as const) {
      const user = await createUser(app, {
        role,
        email: `${role.toLowerCase()}@loja.com`,
      });
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: DEFAULT_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE sale_items, stock_movements, sales, products, categories, audit_logs',
    );
  });

  describe('permissões', () => {
    it('VENDEDOR: 403 nos relatórios e 200 nos alertas', async () => {
      await salesReport('from=2026-11-01&to=2026-11-30', 'VENDEDOR').expect(
        403,
      );
      await http()
        .get('/api/v1/reports/stock-value')
        .set(as('VENDEDOR'))
        .expect(403);
      await http()
        .get('/api/v1/reports/top-products?from=2026-11-01&to=2026-11-30')
        .set(as('VENDEDOR'))
        .expect(403);
      await http().get('/api/v1/stock/alerts').set(as('VENDEDOR')).expect(200);
    });
  });

  describe('vendas por período', () => {
    it('venda às 23h30 em Fortaleza conta no dia local, não no dia UTC', async () => {
      const c = await category();
      const p = await product({ categoryId: c.id, stock: 10 });
      // 23:30 do dia 17 em Fortaleza = 02:30 UTC do dia 18.
      await saleAt('2026-11-17T23:30:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]);
      // 00:30 do dia 18 em Fortaleza = 03:30 UTC do dia 18.
      await saleAt('2026-11-18T00:30:00-03:00', [
        { productId: p.id, quantity: 2 },
      ]);

      const res = await salesReport('from=2026-11-17&to=2026-11-18').expect(
        200,
      );
      expect(res.body.rows).toEqual([
        { period: '2026-11-17', sales: 1, revenue: '10.00' },
        { period: '2026-11-18', sales: 1, revenue: '20.00' },
      ]);
      expect(res.body.timezone).toBe('America/Fortaleza');

      const onlyDay18 = await salesReport('from=2026-11-18&to=2026-11-18');
      expect(onlyDay18.body.totalSales).toBe(1);
    });

    it('dias sem venda aparecem zerados; resumo com ticket médio', async () => {
      const c = await category();
      const p = await product({ categoryId: c.id, stock: 10 });
      await saleAt('2026-11-16T10:00:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]);
      await saleAt('2026-11-18T10:00:00-03:00', [
        { productId: p.id, quantity: 2 },
      ]);

      const res = await salesReport('from=2026-11-15&to=2026-11-18').expect(
        200,
      );
      expect(res.body.rows).toEqual([
        { period: '2026-11-15', sales: 0, revenue: '0.00' },
        { period: '2026-11-16', sales: 1, revenue: '10.00' },
        { period: '2026-11-17', sales: 0, revenue: '0.00' },
        { period: '2026-11-18', sales: 1, revenue: '20.00' },
      ]);
      expect(res.body).toMatchObject({
        totalSales: 2,
        totalRevenue: '30.00',
        averageTicket: '15.00',
      });
    });

    it('sem vendas: ticket médio null', async () => {
      const res = await salesReport('from=2026-11-01&to=2026-11-02').expect(
        200,
      );
      expect(res.body).toMatchObject({
        totalSales: 0,
        totalRevenue: '0.00',
        averageTicket: null,
      });
    });

    it('agrupa por semana (começa na segunda) e por mês', async () => {
      const c = await category();
      const p = await product({ categoryId: c.id, stock: 10 });
      await saleAt('2026-11-02T10:00:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]); // segunda
      await saleAt('2026-11-08T22:00:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]); // domingo, já segunda em UTC
      await saleAt('2026-11-09T10:00:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]); // segunda seguinte
      await saleAt('2026-10-31T23:00:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]); // outubro local, novembro em UTC

      const weeks = await salesReport(
        'from=2026-11-02&to=2026-11-15&groupBy=week',
      ).expect(200);
      expect(weeks.body.rows).toEqual([
        { period: '2026-11-02', sales: 2, revenue: '20.00' },
        { period: '2026-11-09', sales: 1, revenue: '10.00' },
      ]);

      const months = await salesReport(
        'from=2026-10-01&to=2026-11-30&groupBy=month',
      ).expect(200);
      expect(months.body.rows).toEqual([
        { period: '2026-10-01', sales: 1, revenue: '10.00' },
        { period: '2026-11-01', sales: 3, revenue: '30.00' },
      ]);
    });

    it('vender e cancelar não muda o relatório', async () => {
      const c = await category();
      const p = await product({ categoryId: c.id, stock: 10 });
      await saleAt('2026-11-17T10:00:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]);
      const before = await salesReport('from=2026-11-17&to=2026-11-17');

      const extra = await saleAt('2026-11-17T11:00:00-03:00', [
        { productId: p.id, quantity: 3 },
      ]);
      await http()
        .post(`/api/v1/sales/${extra.id}/cancel`)
        .set(as('GERENTE'))
        .send({ reason: 'Teste do relatório' })
        .expect(200);

      const after = await salesReport('from=2026-11-17&to=2026-11-17');
      expect(after.body).toEqual(before.body);
    });

    it.each([
      ['from depois de to', 'from=2026-11-30&to=2026-11-01'],
      ['data inexistente', 'from=2026-02-30&to=2026-03-01'],
      ['mais de 366 dias', 'from=2025-01-01&to=2026-12-31'],
      ['groupBy inválido', 'from=2026-11-01&to=2026-11-30&groupBy=year'],
      ['sem from', 'to=2026-11-30'],
    ])('período inválido (%s): 400', async (_, qs) => {
      await salesReport(qs).expect(400);
    });
  });

  describe('mais vendidos', () => {
    it('ordena por quantidade, respeita o limite e ignora canceladas', async () => {
      const c = await category();
      const a = await product({
        categoryId: c.id,
        stock: 50,
        name: 'A',
        salePrice: '2.00',
      });
      const b = await product({
        categoryId: c.id,
        stock: 50,
        name: 'B',
        salePrice: '5.00',
      });
      const d = await product({ categoryId: c.id, stock: 50, name: 'D' });

      await saleAt('2026-11-10T10:00:00-03:00', [
        { productId: a.id, quantity: 5 },
        { productId: b.id, quantity: 2 },
      ]);
      await saleAt('2026-11-11T10:00:00-03:00', [
        { productId: b.id, quantity: 1 },
      ]);
      const canceled = await saleAt('2026-11-12T10:00:00-03:00', [
        { productId: d.id, quantity: 40 },
      ]);
      await http()
        .post(`/api/v1/sales/${canceled.id}/cancel`)
        .set(as('ADMIN'))
        .send({ reason: 'Teste' })
        .expect(200);

      const res = await http()
        .get(
          '/api/v1/reports/top-products?from=2026-11-01&to=2026-11-30&limit=2',
        )
        .set(as('GERENTE'))
        .expect(200);
      expect(
        res.body.map(
          (r: { name: string; quantity: number; revenue: string }) => [
            r.name,
            r.quantity,
            r.revenue,
          ],
        ),
      ).toEqual([
        ['A', 5, '10.00'],
        ['B', 3, '15.00'],
      ]);
    });
  });

  describe('valor do estoque', () => {
    it('soma a custo e a venda por categoria, inclusive produto desativado', async () => {
      const bebidas = await category('Bebidas');
      const limpeza = await category('Limpeza');
      await product({
        categoryId: bebidas.id,
        stock: 10,
        costPrice: '2.00',
        salePrice: '3.00',
      });
      const inactive = await product({
        categoryId: bebidas.id,
        stock: 5,
        costPrice: '1.00',
        salePrice: '4.00',
      });
      await prisma.product.update({
        where: { id: inactive.id },
        data: { active: false },
      });
      await product({ categoryId: limpeza.id, stock: 0, costPrice: '9.00' }); // sem saldo: fora

      const res = await http()
        .get('/api/v1/reports/stock-value')
        .set(as('ADMIN'))
        .expect(200);
      expect(res.body).toEqual({
        categories: [
          {
            categoryId: bebidas.id,
            categoryName: 'Bebidas',
            products: 2,
            inactiveProducts: 1,
            units: 15,
            costValue: '25.00', // 10 x 2 + 5 x 1
            saleValue: '50.00', // 10 x 3 + 5 x 4
          },
        ],
        totalUnits: 15,
        totalCostValue: '25.00',
        totalSaleValue: '50.00',
      });
    });
  });

  describe('alertas de estoque mínimo', () => {
    it('só ativos com saldo <= mínimo, pela maior falta, sem custo', async () => {
      const c = await category();
      await product({
        categoryId: c.id,
        stock: 1,
        minStock: 3,
        name: 'Falta 2',
      });
      await product({
        categoryId: c.id,
        stock: 0,
        minStock: 10,
        name: 'Falta 10',
      });
      await product({ categoryId: c.id, stock: 20, minStock: 5, name: 'Ok' });
      const off = await product({
        categoryId: c.id,
        stock: 0,
        minStock: 50,
        name: 'Inativo',
      });
      await prisma.product.update({
        where: { id: off.id },
        data: { active: false },
      });

      const res = await http()
        .get('/api/v1/stock/alerts')
        .set(as('VENDEDOR'))
        .expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.map((a: { name: string; shortage: number }) => [
          a.name,
          a.shortage,
        ]),
      ).toEqual([
        ['Falta 10', 10],
        ['Falta 2', 2],
      ]);
      expect(res.body.data[0]).not.toHaveProperty('costPrice');
      expect(res.body.data[0].category).toEqual({ id: c.id, name: 'Geral' });
    });

    it('acompanha a venda na hora (calculado na consulta)', async () => {
      const c = await category();
      const p = await product({ categoryId: c.id, stock: 6, minStock: 5 });
      const before = await http()
        .get('/api/v1/stock/alerts')
        .set(as('GERENTE'));
      expect(before.body.meta.total).toBe(0);

      await saleAt('2026-11-17T10:00:00-03:00', [
        { productId: p.id, quantity: 1 },
      ]);
      const after = await http().get('/api/v1/stock/alerts').set(as('GERENTE'));
      expect(after.body.meta.total).toBe(1);
    });
  });
});
