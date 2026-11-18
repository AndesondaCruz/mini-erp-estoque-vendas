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

describe('Movimentações de estoque (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = {} as Record<Role, string>;
  let categoryId: string;

  const http = () => request(app.getHttpServer());
  const as = (role: Role) => ({ Authorization: `Bearer ${tokens[role]}` });

  const move = (body: Record<string, unknown>, role: Role = 'GERENTE') =>
    http().post('/api/v1/stock/movements').set(as(role)).send(body);

  async function product(overrides: Record<string, unknown> = {}) {
    return prisma.product.create({
      data: {
        sku: `SKU-${crypto.randomUUID().slice(0, 8)}`.toUpperCase(),
        name: 'Produto',
        categoryId,
        costPrice: '1.00',
        salePrice: '2.00',
        ...overrides,
      },
    });
  }

  /** Cria um produto com saldo inicial por uma ENTRADA real (sem atalho). */
  async function productWithStock(stock: number) {
    const p = await product();
    await move({ productId: p.id, type: 'ENTRADA', quantity: stock }).expect(
      201,
    );
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
    categoryId = (await prisma.category.create({ data: { name: 'Geral' } })).id;
  });

  describe('matriz de permissões', () => {
    it('VENDEDOR não movimenta nem lê o histórico (403)', async () => {
      const p = await product();
      await move(
        { productId: p.id, type: 'ENTRADA', quantity: 1 },
        'VENDEDOR',
      ).expect(403);
      await http()
        .get('/api/v1/stock/movements')
        .set(as('VENDEDOR'))
        .expect(403);
      await http()
        .get(`/api/v1/products/${p.id}/movements`)
        .set(as('VENDEDOR'))
        .expect(403);
    });

    it('ADMIN e GERENTE movimentam', async () => {
      const p = await product();
      await move(
        { productId: p.id, type: 'ENTRADA', quantity: 1 },
        'ADMIN',
      ).expect(201);
      await move(
        { productId: p.id, type: 'ENTRADA', quantity: 1 },
        'GERENTE',
      ).expect(201);
      expect(await stockOf(p.id)).toBe(2);
    });
  });

  describe('ENTRADA', () => {
    it('soma ao saldo e grava quantidade, saldo resultante e responsável', async () => {
      const p = await product();
      const res = await move({
        productId: p.id,
        type: 'ENTRADA',
        quantity: 10,
      }).expect(201);
      expect(res.body).toMatchObject({
        type: 'ENTRADA',
        quantity: 10,
        balanceAfter: 10,
        reason: null,
        product: { id: p.id },
        user: { name: expect.any(String) },
      });
      expect(await stockOf(p.id)).toBe(10);
    });

    it.each([
      ['quantidade zero', { quantity: 0 }],
      ['quantidade negativa', { quantity: -5 }],
      ['quantidade fracionada', { quantity: 1.5 }],
      ['sem quantidade', {}],
      ['countedStock em vez de quantity', { countedStock: 3 }],
    ])('inválida (%s): 400', async (_, body) => {
      const p = await product();
      await move({ productId: p.id, type: 'ENTRADA', ...body }).expect(400);
    });

    it('ESTORNO não pode ser lançado pela API (400)', async () => {
      const p = await product();
      await move({
        productId: p.id,
        type: 'ESTORNO',
        quantity: 1,
        reason: 'x',
      }).expect(400);
    });
  });

  describe('SAIDA', () => {
    it('subtrai, grava quantidade negativa e exige motivo', async () => {
      const p = await productWithStock(10);
      await move({ productId: p.id, type: 'SAIDA', quantity: 3 }).expect(400);

      const res = await move({
        productId: p.id,
        type: 'SAIDA',
        quantity: 3,
        reason: 'Avaria no transporte',
      }).expect(201);
      expect(res.body).toMatchObject({ quantity: -3, balanceAfter: 7 });
      expect(await stockOf(p.id)).toBe(7);
    });

    it('estoque insuficiente: 409 com o saldo disponível, saldo intacto', async () => {
      const p = await productWithStock(2);
      const res = await move({
        productId: p.id,
        type: 'SAIDA',
        quantity: 5,
        reason: 'Teste',
      }).expect(409);
      expect(res.body.message).toBe('Estoque insuficiente');
      expect(res.body.details).toEqual({
        productId: p.id,
        requested: 5,
        available: 2,
      });
      expect(await stockOf(p.id)).toBe(2);
    });

    it('produto inativo: 409; produto inexistente: 404', async () => {
      const p = await productWithStock(5);
      await prisma.product.update({
        where: { id: p.id },
        data: { active: false },
      });
      await move({
        productId: p.id,
        type: 'SAIDA',
        quantity: 1,
        reason: 'Teste',
      }).expect(409);
      await move({
        productId: crypto.randomUUID(),
        type: 'SAIDA',
        quantity: 1,
        reason: 'Teste',
      }).expect(404);
    });

    it('5 saídas simultâneas da última unidade: exatamente 1 passa', async () => {
      for (let round = 0; round < 3; round++) {
        const p = await productWithStock(1);
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            move({
              productId: p.id,
              type: 'SAIDA',
              quantity: 1,
              reason: 'Concorrência',
            }),
          ),
        );
        const statuses = results.map((r) => r.status).sort((a, b) => a - b);
        expect(statuses).toEqual([201, 409, 409, 409, 409]);
        expect(await stockOf(p.id)).toBe(0);
      }
    });
  });

  describe('AJUSTE', () => {
    it('recebe o contado, calcula a diferença e exige motivo', async () => {
      const p = await productWithStock(10);
      await move({ productId: p.id, type: 'AJUSTE', countedStock: 7 }).expect(
        400,
      );

      const res = await move({
        productId: p.id,
        type: 'AJUSTE',
        countedStock: 7,
        reason: 'Inventário mensal',
      }).expect(201);
      expect(res.body).toMatchObject({ quantity: -3, balanceAfter: 7 });

      const up = await move({
        productId: p.id,
        type: 'AJUSTE',
        countedStock: 12,
        reason: 'Achado no depósito',
      }).expect(201);
      expect(up.body).toMatchObject({ quantity: 5, balanceAfter: 12 });
    });

    it('contado igual ao saldo: 400; quantity no lugar de countedStock: 400', async () => {
      const p = await productWithStock(4);
      await move({
        productId: p.id,
        type: 'AJUSTE',
        countedStock: 4,
        reason: 'Conferência',
      }).expect(400);
      await move({
        productId: p.id,
        type: 'AJUSTE',
        quantity: 4,
        reason: 'Conferência',
      }).expect(400);
    });

    it('ajuste simultâneo a uma saída não perde nenhuma das duas', async () => {
      // Saldo 9. Ao mesmo tempo: inventário conta 7 e sai 2.
      // Ordem A (ajuste antes): 9 -> 7 -> 5. Ordem B (saída antes): 9 -> 7 -> 7.
      // As duas são corretas; o que não pode é o saldo divergir do histórico.
      for (let round = 0; round < 3; round++) {
        const p = await productWithStock(9);
        const [adjust, exit] = await Promise.all([
          move({
            productId: p.id,
            type: 'AJUSTE',
            countedStock: 7,
            reason: 'Inventário',
          }),
          move({
            productId: p.id,
            type: 'SAIDA',
            quantity: 2,
            reason: 'Avaria',
          }),
        ]);
        expect(exit.status).toBe(201);
        // Se a saída veio antes, o saldo já era 7 e o ajuste não tem diferença.
        expect([201, 400]).toContain(adjust.status);
        expect([5, 7]).toContain(await stockOf(p.id));
        await expectInvariant(p.id);
      }
    });
  });

  /** Risco 3: saldo = soma das quantidades = saldo da última movimentação. */
  async function expectInvariant(productId: string) {
    const [row] = await prisma.$queryRaw<
      { current_stock: number; sum: bigint; last_balance: number }[]
    >`
      SELECT p.current_stock,
             COALESCE(SUM(m.quantity), 0) AS sum,
             (SELECT balance_after FROM stock_movements
              WHERE product_id = p.id
              ORDER BY created_at DESC, id DESC LIMIT 1) AS last_balance
      FROM products p
      LEFT JOIN stock_movements m ON m.product_id = p.id
      WHERE p.id = ${productId}::uuid
      GROUP BY p.id`;
    expect(Number(row.sum)).toBe(row.current_stock);
    expect(row.last_balance).toBe(row.current_stock);
  }

  describe('invariante e histórico', () => {
    it('depois de uma sequência mista, saldo = soma das movimentações', async () => {
      const p = await productWithStock(20);
      const steps = [
        { type: 'SAIDA', quantity: 4, reason: 'Avaria' },
        { type: 'ENTRADA', quantity: 7 },
        { type: 'AJUSTE', countedStock: 18, reason: 'Inventário' },
        { type: 'SAIDA', quantity: 1, reason: 'Consumo interno' },
      ];
      for (const step of steps) {
        await move({ productId: p.id, ...step }).expect(201);
      }
      expect(await stockOf(p.id)).toBe(17);
      await expectInvariant(p.id);
    });

    it('nenhuma linha do banco foge da invariante (query de reconciliação)', async () => {
      await productWithStock(3);
      const other = await productWithStock(8);
      await move({
        productId: other.id,
        type: 'SAIDA',
        quantity: 8,
        reason: 'Perda',
      }).expect(201);

      // Mesma query documentada em docs/aprendizados.md para uso operacional.
      const divergent = await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id
        FROM products p
        LEFT JOIN stock_movements m ON m.product_id = p.id
        GROUP BY p.id, p.current_stock
        HAVING p.current_stock <> COALESCE(SUM(m.quantity), 0)`;
      expect(divergent).toEqual([]);
    });

    it('extrato do produto (mais recente primeiro) e filtros do histórico', async () => {
      const p = await productWithStock(5);
      await move({
        productId: p.id,
        type: 'SAIDA',
        quantity: 2,
        reason: 'Avaria',
      }).expect(201);
      const other = await productWithStock(1);

      const extrato = await http()
        .get(`/api/v1/products/${p.id}/movements`)
        .set(as('GERENTE'))
        .expect(200);
      expect(extrato.body.data.map((m: { type: string }) => m.type)).toEqual([
        'SAIDA',
        'ENTRADA',
      ]);

      const saidas = await http()
        .get('/api/v1/stock/movements?type=SAIDA')
        .set(as('ADMIN'))
        .expect(200);
      expect(saidas.body.meta.total).toBe(1);

      const futuro = await http()
        .get('/api/v1/stock/movements?from=2999-01-01T00:00:00Z')
        .set(as('ADMIN'))
        .expect(200);
      expect(futuro.body.data).toEqual([]);

      await http()
        .get(`/api/v1/products/${crypto.randomUUID()}/movements`)
        .set(as('ADMIN'))
        .expect(404);
      expect(other.id).toBeDefined();
    });

    it('saída manual e ajuste vão para a auditoria; entrada não', async () => {
      const p = await productWithStock(5);
      await move({
        productId: p.id,
        type: 'SAIDA',
        quantity: 1,
        reason: 'Avaria',
      }).expect(201);
      await move({
        productId: p.id,
        type: 'AJUSTE',
        countedStock: 2,
        reason: 'Inventário',
      }).expect(201);

      const actions = (
        await prisma.auditLog.findMany({
          where: { entity: 'StockMovement' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(['STOCK_MANUAL_EXIT', 'STOCK_ADJUSTED']);
    });
  });

  describe('regras no banco', () => {
    it('movimentação não pode ser alterada nem apagada (trigger)', async () => {
      const p = await productWithStock(1);
      await expect(
        prisma.$executeRaw`UPDATE stock_movements SET quantity = 999 WHERE product_id = ${p.id}::uuid`,
      ).rejects.toThrow(/somente inserção/);
      await expect(
        prisma.$executeRaw`DELETE FROM stock_movements WHERE product_id = ${p.id}::uuid`,
      ).rejects.toThrow(/somente inserção/);
    });

    it('CHECK recusa saída com quantidade positiva e saída sem motivo', async () => {
      const p = await product();
      const [user] = await prisma.user.findMany({ take: 1 });
      await expect(
        prisma.$executeRaw`
          INSERT INTO stock_movements (id, product_id, type, quantity, balance_after, reason, user_id)
          VALUES (gen_random_uuid(), ${p.id}::uuid, 'SAIDA', 5, 0, 'x', ${user.id}::uuid)`,
      ).rejects.toThrow(/stock_movements_sign_chk/);
      await expect(
        prisma.$executeRaw`
          INSERT INTO stock_movements (id, product_id, type, quantity, balance_after, user_id)
          VALUES (gen_random_uuid(), ${p.id}::uuid, 'SAIDA', -1, 0, ${user.id}::uuid)`,
      ).rejects.toThrow(/stock_movements_reason_chk/);
    });

    it('a API de produtos continua sem aceitar currentStock', async () => {
      const p = await product();
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(as('ADMIN'))
        .send({ currentStock: 50 })
        .expect(400);
    });
  });
});
