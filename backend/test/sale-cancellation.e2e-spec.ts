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

describe('Cancelamento de venda (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = {} as Record<Role, string>;
  const ids = {} as Record<Role, string>;
  let categoryId: string;

  const http = () => request(app.getHttpServer());
  const as = (role: Role) => ({ Authorization: `Bearer ${tokens[role]}` });

  type Item = { productId: string; quantity: number };
  const sell = (items: Item[]) =>
    http()
      .post('/api/v1/sales')
      .set(as('VENDEDOR'))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ items });

  const cancel = (
    saleId: string,
    role: Role = 'GERENTE',
    body: Record<string, unknown> = { reason: 'Cliente desistiu' },
  ) => http().post(`/api/v1/sales/${saleId}/cancel`).set(as(role)).send(body);

  async function product(stock: number) {
    const p = await prisma.product.create({
      data: {
        sku: `SKU-${crypto.randomUUID().slice(0, 8)}`.toUpperCase(),
        name: 'Produto',
        categoryId,
        costPrice: '1.00',
        salePrice: '2.50',
      },
    });
    await http()
      .post('/api/v1/stock/movements')
      .set(as('GERENTE'))
      .send({ productId: p.id, type: 'ENTRADA', quantity: stock })
      .expect(201);
    return p;
  }

  const stockOf = async (id: string) =>
    (await prisma.product.findUniqueOrThrow({ where: { id } })).currentStock;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    for (const role of ['ADMIN', 'GERENTE', 'VENDEDOR'] as const) {
      const user = await createUser(app, {
        role,
        email: `${role.toLowerCase()}@loja.com`,
        name: `Pessoa ${role}`,
      });
      ids[role] = user.id;
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
    categoryId = (await prisma.category.create({ data: { name: 'Geral' } })).id;
  });

  it('cancela, devolve o estoque de todos os itens e registra quem, quando e por quê', async () => {
    const a = await product(10);
    const b = await product(10);
    const sale = await sell([
      { productId: a.id, quantity: 3 },
      { productId: b.id, quantity: 2 },
    ]).expect(201);
    expect(await stockOf(a.id)).toBe(7);

    const res = await cancel(sale.body.id, 'GERENTE', {
      reason: '  Cliente desistiu  ',
    }).expect(200);
    expect(res.body).toMatchObject({
      status: 'CANCELADA',
      cancelReason: 'Cliente desistiu',
      canceledBy: { id: ids.GERENTE },
      canceledAt: expect.any(String),
      total: '12.50', // o total continua registrado
    });
    expect(await stockOf(a.id)).toBe(10);
    expect(await stockOf(b.id)).toBe(10);

    const estornos = await prisma.stockMovement.findMany({
      where: { type: 'ESTORNO' },
    });
    expect(estornos).toHaveLength(2);
    expect(
      estornos.every(
        (m) => m.saleId === sale.body.id && m.reason === 'Cliente desistiu',
      ),
    ).toBe(true);
  });

  it('cancelar de novo: 409, sem estornar outra vez', async () => {
    const a = await product(5);
    const sale = await sell([{ productId: a.id, quantity: 2 }]).expect(201);
    await cancel(sale.body.id).expect(200);

    const res = await cancel(sale.body.id).expect(409);
    expect(res.body.message).toBe('Venda já cancelada');
    expect(await stockOf(a.id)).toBe(5);
  });

  it('5 cancelamentos simultâneos: 1 vence e o estoque volta uma vez só', async () => {
    for (let round = 0; round < 3; round++) {
      const a = await product(10);
      const sale = await sell([{ productId: a.id, quantity: 4 }]).expect(201);

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          cancel(sale.body.id, i % 2 ? 'ADMIN' : 'GERENTE'),
        ),
      );
      const statuses = results.map((r) => r.status).sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409, 409, 409, 409]);
      expect(await stockOf(a.id)).toBe(10);
    }
  });

  it('produto desativado depois da venda: o estoque volta mesmo assim', async () => {
    const a = await product(5);
    const sale = await sell([{ productId: a.id, quantity: 2 }]).expect(201);
    await http()
      .delete(`/api/v1/products/${a.id}`)
      .set(as('ADMIN'))
      .expect(204);

    await cancel(sale.body.id).expect(200);
    expect(await stockOf(a.id)).toBe(5);
  });

  it('VENDEDOR não cancela, nem a própria venda (403)', async () => {
    const a = await product(5);
    const sale = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
    await cancel(sale.body.id, 'VENDEDOR').expect(403);
    expect(await stockOf(a.id)).toBe(4);
  });

  it('sem motivo ou só com espaços: 400; venda inexistente: 404', async () => {
    const a = await product(5);
    const sale = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
    await cancel(sale.body.id, 'GERENTE', {}).expect(400);
    await cancel(sale.body.id, 'GERENTE', { reason: '   ' }).expect(400);
    await cancel(crypto.randomUUID()).expect(404);
    expect(await stockOf(a.id)).toBe(4);
  });

  it('cancelamento e venda nova dos mesmos produtos ao mesmo tempo: sem deadlock', async () => {
    const a = await product(100);
    const b = await product(100);
    for (let round = 0; round < 10; round++) {
      const old = await sell([
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 1 },
      ]).expect(201);
      const results = await Promise.all([
        cancel(old.body.id),
        sell([
          { productId: b.id, quantity: 1 },
          { productId: a.id, quantity: 1 },
        ]),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 201]);
    }
    // 10 vendas canceladas (líquido 0) + 10 vendas novas de 1 unidade.
    expect(await stockOf(a.id)).toBe(90);
    expect(await stockOf(b.id)).toBe(90);
  });

  it('depois de vendas e cancelamentos, saldo = soma das movimentações', async () => {
    const a = await product(30);
    const sales = await Promise.all(
      Array.from({ length: 4 }, () => sell([{ productId: a.id, quantity: 2 }])),
    );
    await Promise.all(sales.slice(0, 2).map((s) => cancel(s.body.id)));

    expect(await stockOf(a.id)).toBe(26);
    const divergent = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id
      FROM products p
      LEFT JOIN stock_movements m ON m.product_id = p.id
      GROUP BY p.id, p.current_stock
      HAVING p.current_stock <> COALESCE(SUM(m.quantity), 0)`;
    expect(divergent).toEqual([]);
  });

  it('vai para a auditoria com o status antes e depois', async () => {
    const a = await product(5);
    const sale = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
    await cancel(sale.body.id, 'ADMIN', { reason: 'Erro de digitação' }).expect(
      200,
    );

    const [log] = await prisma.auditLog.findMany({
      where: { action: 'SALE_CANCELED' },
    });
    expect(log).toMatchObject({ userId: ids.ADMIN, entityId: sale.body.id });
    expect(log.before).toMatchObject({ status: 'CONCLUIDA' });
    expect(log.after).toMatchObject({
      status: 'CANCELADA',
      cancelReason: 'Erro de digitação',
    });
  });

  it('a venda cancelada continua visível no histórico, com o status', async () => {
    const a = await product(5);
    const sale = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
    await cancel(sale.body.id).expect(200);

    const res = await http()
      .get('/api/v1/sales?status=CANCELADA')
      .set(as('VENDEDOR'))
      .expect(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([
      sale.body.id,
    ]);
  });
});
