import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createUser,
  DEFAULT_PASSWORD,
  resetDatabase,
} from './helpers.js';

type Who = 'ADMIN' | 'GERENTE' | 'VENDEDOR' | 'VENDEDOR2';

describe('Vendas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = {} as Record<Who, string>;
  const ids = {} as Record<Who, string>;
  let categoryId: string;

  const http = () => request(app.getHttpServer());
  const as = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });
  const key = () => crypto.randomUUID();

  type Item = { productId: string; quantity: number };
  const sell = (items: Item[], who: Who = 'VENDEDOR', idemKey = key()) =>
    http()
      .post('/api/v1/sales')
      .set(as(who))
      .set('Idempotency-Key', idemKey)
      .send({ items });

  /** Produto com saldo vindo de uma ENTRADA real (mantém a invariante). */
  async function product(
    stock: number,
    salePrice = '5.50',
    costPrice = '3.20',
  ) {
    const p = await prisma.product.create({
      data: {
        sku: `SKU-${crypto.randomUUID().slice(0, 8)}`.toUpperCase(),
        name: 'Produto',
        categoryId,
        costPrice,
        salePrice,
      },
    });
    if (stock > 0) {
      await http()
        .post('/api/v1/stock/movements')
        .set(as('GERENTE'))
        .send({ productId: p.id, type: 'ENTRADA', quantity: stock })
        .expect(201);
    }
    return p;
  }

  const stockOf = async (id: string) =>
    (await prisma.product.findUniqueOrThrow({ where: { id } })).currentStock;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    const roles: Record<Who, 'ADMIN' | 'GERENTE' | 'VENDEDOR'> = {
      ADMIN: 'ADMIN',
      GERENTE: 'GERENTE',
      VENDEDOR: 'VENDEDOR',
      VENDEDOR2: 'VENDEDOR',
    };
    for (const who of Object.keys(roles) as Who[]) {
      const user = await createUser(app, {
        role: roles[who],
        email: `${who.toLowerCase()}@loja.com`,
        name: `Pessoa ${who}`,
      });
      ids[who] = user.id;
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: DEFAULT_PASSWORD })
        .expect(200);
      tokens[who] = res.body.accessToken as string;
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

  describe('registro', () => {
    it('baixa todos os itens, calcula o total no servidor e liga as saídas à venda', async () => {
      const a = await product(10, '5.50');
      const b = await product(10, '2.25');

      const res = await sell([
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 3 },
      ]).expect(201);

      expect(res.body).toMatchObject({
        number: expect.any(Number),
        status: 'CONCLUIDA',
        total: '17.75', // 2 x 5.50 + 3 x 2.25
        seller: { id: ids.VENDEDOR },
      });
      expect(await stockOf(a.id)).toBe(8);
      expect(await stockOf(b.id)).toBe(7);

      const exits = await prisma.stockMovement.findMany({
        where: { type: 'SAIDA' },
      });
      expect(exits).toHaveLength(2);
      expect(exits.every((m) => m.saleId === res.body.id)).toBe(true);
      expect(exits.every((m) => m.reason === null)).toBe(true);
    });

    it('VENDEDOR não recebe o custo dos itens; GERENTE recebe', async () => {
      const a = await product(5);
      const res = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
      expect(res.body.items[0]).not.toHaveProperty('unitCost');
      expect(res.body.items[0]).toMatchObject({
        unitPrice: '5.50',
        subtotal: '5.50',
      });

      const asManager = await http()
        .get(`/api/v1/sales/${res.body.id}`)
        .set(as('GERENTE'))
        .expect(200);
      expect(asManager.body.items[0].unitCost).toBe('3.20');
    });

    it.each(['ADMIN', 'GERENTE', 'VENDEDOR2'] as const)(
      '%s também registra vendas',
      async (who) => {
        const a = await product(1);
        await sell([{ productId: a.id, quantity: 1 }], who).expect(201);
      },
    );

    it.each([
      ['sem itens', { items: [] }],
      ['preço enviado pelo cliente', { unitPrice: '0.01' }],
      ['quantidade zero', { quantity: 0 }],
    ])('corpo inválido (%s): 400', async (_, change) => {
      const a = await product(5);
      const item = { productId: a.id, quantity: 1, ...change };
      const body = 'items' in change ? change : { items: [item] };
      await http()
        .post('/api/v1/sales')
        .set(as('VENDEDOR'))
        .set('Idempotency-Key', key())
        .send(body)
        .expect(400);
      expect(await stockOf(a.id)).toBe(5);
    });

    it('produto repetido em dois itens: 400', async () => {
      const a = await product(5);
      await sell([
        { productId: a.id, quantity: 1 },
        { productId: a.id, quantity: 1 },
      ]).expect(400);
    });

    it('sem Idempotency-Key ou com valor inválido: 400', async () => {
      const a = await product(5);
      const body = { items: [{ productId: a.id, quantity: 1 }] };
      const res = await http()
        .post('/api/v1/sales')
        .set(as('VENDEDOR'))
        .send(body)
        .expect(400);
      expect(res.body.message).toContain('Idempotency-Key');
      await http()
        .post('/api/v1/sales')
        .set(as('VENDEDOR'))
        .set('Idempotency-Key', 'abc')
        .send(body)
        .expect(400);
    });
  });

  describe('tudo ou nada', () => {
    it('um item sem saldo desfaz a venda inteira: 409 com detalhes, nada baixado', async () => {
      const a = await product(10);
      const b = await product(10);
      const c = await product(1);

      const res = await sell([
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 2 },
        { productId: c.id, quantity: 5 },
      ]).expect(409);
      expect(res.body.details).toMatchObject({
        productId: c.id,
        requested: 5,
        available: 1,
      });

      expect(await stockOf(a.id)).toBe(10);
      expect(await stockOf(b.id)).toBe(10);
      expect(await prisma.sale.count()).toBe(0);
      expect(
        await prisma.stockMovement.count({ where: { type: 'SAIDA' } }),
      ).toBe(0);
    });

    it('produto inativo: 409; inexistente: 404; nada é gravado', async () => {
      const a = await product(5);
      await prisma.product.update({
        where: { id: a.id },
        data: { active: false },
      });
      await sell([{ productId: a.id, quantity: 1 }]).expect(409);
      await sell([{ productId: crypto.randomUUID(), quantity: 1 }]).expect(404);
      expect(await prisma.sale.count()).toBe(0);
    });
  });

  describe('snapshot de preço (risco 6)', () => {
    it('mudar o preço depois não altera a venda já registrada', async () => {
      const a = await product(5, '5.50');
      const sale = await sell([{ productId: a.id, quantity: 2 }]).expect(201);

      await http()
        .patch(`/api/v1/products/${a.id}`)
        .set(as('GERENTE'))
        .send({ salePrice: '9.99' })
        .expect(200);

      const res = await http()
        .get(`/api/v1/sales/${sale.body.id}`)
        .set(as('VENDEDOR'))
        .expect(200);
      expect(res.body.total).toBe('11.00');
      expect(res.body.items[0].unitPrice).toBe('5.50');
    });
  });

  describe('idempotência (risco 5)', () => {
    it('retry com a mesma chave devolve a mesma venda (200) e não baixa de novo', async () => {
      const a = await product(10);
      const k = key();
      const items = [{ productId: a.id, quantity: 3 }];

      const first = await sell(items, 'VENDEDOR', k).expect(201);
      const retry = await sell(items, 'VENDEDOR', k).expect(200);
      expect(retry.body.id).toBe(first.body.id);
      expect(await stockOf(a.id)).toBe(7);
      expect(await prisma.sale.count()).toBe(1);
    });

    it('mesma chave com outros itens, ou de outro vendedor: 409', async () => {
      const a = await product(10);
      const k = key();
      await sell([{ productId: a.id, quantity: 1 }], 'VENDEDOR', k).expect(201);

      await sell([{ productId: a.id, quantity: 2 }], 'VENDEDOR', k).expect(409);
      await sell([{ productId: a.id, quantity: 1 }], 'VENDEDOR2', k).expect(
        409,
      );
      expect(await stockOf(a.id)).toBe(9);
    });

    it('5 envios simultâneos com a mesma chave: 1 venda e 1 baixa', async () => {
      for (let round = 0; round < 3; round++) {
        const a = await product(10);
        const k = key();
        const items = [{ productId: a.id, quantity: 2 }];

        const results = await Promise.all(
          Array.from({ length: 5 }, () => sell(items, 'VENDEDOR', k)),
        );
        const statuses = results.map((r) => r.status).sort((x, y) => x - y);
        expect(statuses).toEqual([200, 200, 200, 200, 201]);
        expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
        expect(await stockOf(a.id)).toBe(8);
      }
    });
  });

  describe('concorrência no estoque', () => {
    it('5 vendas simultâneas da última unidade: exatamente 1 passa (risco 1)', async () => {
      for (let round = 0; round < 3; round++) {
        const a = await product(1);
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            sell([{ productId: a.id, quantity: 1 }]),
          ),
        );
        const statuses = results.map((r) => r.status).sort((x, y) => x - y);
        expect(statuses).toEqual([201, 409, 409, 409, 409]);
        expect(await stockOf(a.id)).toBe(0);
      }
    });

    it('vendas cruzadas [A, B] e [B, A] ao mesmo tempo: nenhum deadlock (risco 2)', async () => {
      const a = await product(100);
      const b = await product(100);
      for (let round = 0; round < 10; round++) {
        const results = await Promise.all([
          sell([
            { productId: a.id, quantity: 1 },
            { productId: b.id, quantity: 1 },
          ]),
          sell(
            [
              { productId: b.id, quantity: 1 },
              { productId: a.id, quantity: 1 },
            ],
            'VENDEDOR2',
          ),
        ]);
        expect(results.map((r) => r.status)).toEqual([201, 201]);
      }
      expect(await stockOf(a.id)).toBe(80);
      expect(await stockOf(b.id)).toBe(80);
    });

    it('depois de tudo, saldo = soma das movimentações (risco 3)', async () => {
      const a = await product(20);
      const b = await product(20);
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          sell([
            { productId: a.id, quantity: 1 + (i % 3) },
            { productId: b.id, quantity: 1 },
          ]),
        ),
      );
      const divergent = await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id
        FROM products p
        LEFT JOIN stock_movements m ON m.product_id = p.id
        GROUP BY p.id, p.current_stock
        HAVING p.current_stock <> COALESCE(SUM(m.quantity), 0)`;
      expect(divergent).toEqual([]);
    });
  });

  describe('consulta e IDOR (risco 8)', () => {
    it('VENDEDOR só vê as próprias vendas; a de outro responde 404', async () => {
      const a = await product(10);
      const mine = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
      const other = await sell(
        [{ productId: a.id, quantity: 1 }],
        'VENDEDOR2',
      ).expect(201);

      const list = await http()
        .get(`/api/v1/sales?sellerId=${ids.VENDEDOR2}`)
        .set(as('VENDEDOR'))
        .expect(200);
      expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([
        mine.body.id,
      ]);

      await http()
        .get(`/api/v1/sales/${other.body.id}`)
        .set(as('VENDEDOR'))
        .expect(404);
    });

    it('GERENTE vê todas e filtra por vendedor', async () => {
      const a = await product(10);
      await sell([{ productId: a.id, quantity: 1 }]).expect(201);
      await sell([{ productId: a.id, quantity: 1 }], 'VENDEDOR2').expect(201);

      const all = await http()
        .get('/api/v1/sales')
        .set(as('GERENTE'))
        .expect(200);
      expect(all.body.meta.total).toBe(2);

      const filtered = await http()
        .get(`/api/v1/sales?sellerId=${ids.VENDEDOR2}`)
        .set(as('GERENTE'))
        .expect(200);
      expect(filtered.body.meta.total).toBe(1);
    });

    it('cada venda registrada vai para a auditoria', async () => {
      const a = await product(5);
      const sale = await sell([{ productId: a.id, quantity: 2 }]).expect(201);
      const [log] = await prisma.auditLog.findMany({
        where: { action: 'SALE_CREATED' },
      });
      expect(log.entityId).toBe(sale.body.id);
      expect(log.after).toMatchObject({ total: '11.00', status: 'CONCLUIDA' });
      // SKU e nome da época, para a tela de auditoria não depender do
      // cadastro atual do produto.
      expect(log.after).toMatchObject({
        items: [
          {
            productId: a.id,
            sku: a.sku,
            name: a.name,
            quantity: 2,
            unitPrice: '5.50',
          },
        ],
      });
    });
  });

  describe('regras no banco', () => {
    it('CHECK recusa item com subtotal diferente de quantidade x preço', async () => {
      const a = await product(5);
      const sale = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
      const b = await product(0);
      await expect(
        prisma.$executeRaw`
          INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
          VALUES (gen_random_uuid(), ${sale.body.id}::uuid, ${b.id}::uuid, 2, 5.00, 1.00, 1.00)`,
      ).rejects.toThrow(/sale_items_subtotal_chk/);
    });

    it('CHECK recusa venda cancelada sem motivo', async () => {
      const a = await product(5);
      const sale = await sell([{ productId: a.id, quantity: 1 }]).expect(201);
      await expect(
        prisma.$executeRaw`UPDATE sales SET status = 'CANCELADA' WHERE id = ${sale.body.id}::uuid`,
      ).rejects.toThrow(/sales_cancel_fields_chk/);
    });

    it('saída manual continua exigindo motivo (só a de venda dispensa)', async () => {
      const a = await product(5);
      await http()
        .post('/api/v1/stock/movements')
        .set(as('GERENTE'))
        .send({ productId: a.id, type: 'SAIDA', quantity: 1 })
        .expect(400);
    });
  });
});
