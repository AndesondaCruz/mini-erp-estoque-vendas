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

describe('Produtos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = {} as Record<Role, string>;
  let categoryId: string;

  const http = () => request(app.getHttpServer());
  const as = (role: Role) => ({ Authorization: `Bearer ${tokens[role]}` });

  const base = (overrides: Record<string, unknown> = {}) => ({
    sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
    name: 'Cerveja lata 350 ml',
    categoryId,
    costPrice: '3.20',
    salePrice: '5.50',
    ...overrides,
  });
  const create = (
    overrides: Record<string, unknown> = {},
    role: Role = 'GERENTE',
  ) => http().post('/api/v1/products').set(as(role)).send(base(overrides));

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
      'TRUNCATE TABLE products, categories, suppliers, audit_logs',
    );
    categoryId = (await prisma.category.create({ data: { name: 'Bebidas' } }))
      .id;
  });

  describe('matriz de permissões', () => {
    it('VENDEDOR lê, mas não cria nem edita (403)', async () => {
      const { body } = await create().expect(201);
      await http().get('/api/v1/products').set(as('VENDEDOR')).expect(200);
      await http()
        .get(`/api/v1/products/${body.id}`)
        .set(as('VENDEDOR'))
        .expect(200);
      await create({}, 'VENDEDOR').expect(403);
      await http()
        .patch(`/api/v1/products/${body.id}`)
        .set(as('VENDEDOR'))
        .send({ name: 'X' })
        .expect(403);
    });

    it('GERENTE edita, mas não desativa (403 no DELETE e no active)', async () => {
      const { body } = await create().expect(201);
      await http()
        .patch(`/api/v1/products/${body.id}`)
        .set(as('GERENTE'))
        .send({ name: 'Novo nome' })
        .expect(200);
      await http()
        .delete(`/api/v1/products/${body.id}`)
        .set(as('GERENTE'))
        .expect(403);
      await http()
        .patch(`/api/v1/products/${body.id}`)
        .set(as('GERENTE'))
        .send({ active: true })
        .expect(403);
    });
  });

  describe('preço de custo por papel', () => {
    it('VENDEDOR não recebe a chave costPrice, nem na lista nem no detalhe', async () => {
      const { body } = await create().expect(201);

      const list = await http()
        .get('/api/v1/products')
        .set(as('VENDEDOR'))
        .expect(200);
      expect(list.body.data[0]).not.toHaveProperty('costPrice');
      expect(list.body.data[0].salePrice).toBe('5.50');

      const one = await http()
        .get(`/api/v1/products/${body.id}`)
        .set(as('VENDEDOR'))
        .expect(200);
      expect(one.body).not.toHaveProperty('costPrice');
    });

    it('ADMIN e GERENTE recebem o costPrice', async () => {
      const { body } = await create().expect(201);
      for (const role of ['ADMIN', 'GERENTE'] as const) {
        const res = await http()
          .get(`/api/v1/products/${body.id}`)
          .set(as(role))
          .expect(200);
        expect(res.body.costPrice).toBe('3.20');
      }
    });
  });

  describe('cadastro', () => {
    it('cria com saldo 0, SKU em maiúsculas e preços com 2 casas', async () => {
      const res = await create({ sku: ' cer-350 ', salePrice: '5.5' }).expect(
        201,
      );
      expect(res.body).toMatchObject({
        sku: 'CER-350',
        salePrice: '5.50',
        currentStock: 0,
        minStock: 0,
        supplier: null,
        category: { id: categoryId, name: 'Bebidas' },
        active: true,
      });
    });

    it.each([
      ['número em vez de texto', { salePrice: 5.5 }],
      ['três casas decimais', { salePrice: '5.505' }],
      ['negativo', { costPrice: '-1.00' }],
      ['vírgula decimal', { salePrice: '5,50' }],
    ])('dinheiro inválido (%s): 400', async (_, overrides) => {
      await create(overrides).expect(400);
    });

    it('enviar currentStock: 400 (saldo só muda por movimentação)', async () => {
      await create({ currentStock: 100 }).expect(400);
    });

    it('SKU repetido, mesmo em minúsculas: 409', async () => {
      await create({ sku: 'CER-350' }).expect(201);
      const res = await create({ sku: 'cer-350' }).expect(409);
      expect(res.body.message).toBe('SKU já cadastrado');
    });

    it('categoria inexistente: 400 (dado inválido, não conflito)', async () => {
      await create({ categoryId: crypto.randomUUID() }).expect(400);
    });

    it('fornecedor é opcional; inativo ou inexistente: 400', async () => {
      const active = await prisma.supplier.create({ data: { name: 'Ativo' } });
      const inactive = await prisma.supplier.create({
        data: { name: 'Inativo', active: false },
      });

      const res = await create({ supplierId: active.id }).expect(201);
      expect(res.body.supplier).toEqual({ id: active.id, name: 'Ativo' });

      const r1 = await create({ supplierId: inactive.id }).expect(400);
      expect(r1.body.message).toBe('Fornecedor inativo');
      await create({ supplierId: crypto.randomUUID() }).expect(400);
    });
  });

  describe('listagem', () => {
    it('lowStock compara saldo e mínimo de cada produto', async () => {
      const low = await create({ name: 'Baixo', minStock: 5 }).expect(201);
      const ok = await create({ name: 'Ok', minStock: 5 }).expect(201);
      // Fase 3 fará isso por movimentação; aqui o saldo é ajustado direto.
      await prisma.product.update({
        where: { id: ok.body.id },
        data: { currentStock: 20 },
      });

      const res = await http()
        .get('/api/v1/products?lowStock=true')
        .set(as('VENDEDOR'))
        .expect(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([
        low.body.id,
      ]);
      expect(res.body.data[0].lowStock).toBe(true);
    });

    it('VENDEDOR não vê produto inativo, mesmo pedindo active=false', async () => {
      const { body } = await create({ name: 'Descontinuado' }).expect(201);
      await http()
        .delete(`/api/v1/products/${body.id}`)
        .set(as('ADMIN'))
        .expect(204);

      const vendedor = await http()
        .get('/api/v1/products?active=false')
        .set(as('VENDEDOR'))
        .expect(200);
      expect(vendedor.body.data).toEqual([]);
      await http()
        .get(`/api/v1/products/${body.id}`)
        .set(as('VENDEDOR'))
        .expect(404);

      const gerente = await http()
        .get('/api/v1/products?active=false')
        .set(as('GERENTE'))
        .expect(200);
      expect(gerente.body.data).toHaveLength(1);
    });

    it('busca por nome ou SKU; ordenação fora da lista: 400', async () => {
      await create({ sku: 'REF-001', name: 'Refrigerante' }).expect(201);
      await create({ sku: 'AGU-001', name: 'Água mineral' }).expect(201);

      const bySku = await http()
        .get('/api/v1/products?search=ref-0')
        .set(as('VENDEDOR'))
        .expect(200);
      expect(bySku.body.data.map((p: { sku: string }) => p.sku)).toEqual([
        'REF-001',
      ]);

      await http()
        .get('/api/v1/products?sort=costPrice')
        .set(as('ADMIN'))
        .expect(400);
    });
  });

  describe('auditoria', () => {
    const auditOf = (entityId: string, action: string) =>
      prisma.auditLog.findMany({
        where: { entityId, action },
        orderBy: { createdAt: 'asc' },
      });

    it('mudança de preço é auditada com antes e depois; outras edições não', async () => {
      const { body } = await create().expect(201);
      const patch = (data: Record<string, unknown>) =>
        http()
          .patch(`/api/v1/products/${body.id}`)
          .set(as('GERENTE'))
          .send(data)
          .expect(200);

      await patch({ name: 'Outro nome' });
      await patch({ salePrice: '5.5' }); // mesmo valor que 5.50: não muda nada
      expect(await auditOf(body.id, 'PRODUCT_PRICE_CHANGED')).toHaveLength(0);

      await patch({ salePrice: '6.00' });
      const [log] = await auditOf(body.id, 'PRODUCT_PRICE_CHANGED');
      expect(log.before).toMatchObject({
        salePrice: '5.50',
        costPrice: '3.20',
      });
      expect(log.after).toMatchObject({ salePrice: '6.00', costPrice: '3.20' });
    });

    it('preços alterados ao mesmo tempo formam uma cadeia sem buracos', async () => {
      const { body } = await create({ salePrice: '10.00' }).expect(201);
      const prices = ['11.00', '12.00', '13.00', '14.00', '15.00'];

      await Promise.all(
        prices.map((salePrice) =>
          http()
            .patch(`/api/v1/products/${body.id}`)
            .set(as('GERENTE'))
            .send({ salePrice })
            .expect(200),
        ),
      );

      // Cada "antes" precisa ser o "depois" de outra alteração. Sem o lock,
      // duas transações leriam o mesmo "antes" e um elo sumiria.
      const logs = await auditOf(body.id, 'PRODUCT_PRICE_CHANGED');
      const next = new Map(
        logs.map((l) => [
          (l.before as { salePrice: string }).salePrice,
          (l.after as { salePrice: string }).salePrice,
        ]),
      );
      expect(next.size).toBe(prices.length);

      let price = '10.00';
      for (let i = 0; i < prices.length; i++) {
        const following = next.get(price);
        expect(following).toBeDefined();
        price = following as string;
      }
      const final = await prisma.product.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(final.salePrice.toFixed(2)).toBe(price);
    });

    it('desativar e reativar são auditados; desativar de novo não duplica', async () => {
      const { body } = await create().expect(201);
      const del = () =>
        http()
          .delete(`/api/v1/products/${body.id}`)
          .set(as('ADMIN'))
          .expect(204);

      await del();
      await del();
      expect(await auditOf(body.id, 'PRODUCT_DEACTIVATED')).toHaveLength(1);

      await http()
        .patch(`/api/v1/products/${body.id}`)
        .set(as('ADMIN'))
        .send({ active: true })
        .expect(200);
      expect(await auditOf(body.id, 'PRODUCT_REACTIVATED')).toHaveLength(1);
    });
  });

  describe('regras no banco', () => {
    it('categoria com produtos não pode ser excluída: 409', async () => {
      await create().expect(201);
      const res = await http()
        .delete(`/api/v1/categories/${categoryId}`)
        .set(as('GERENTE'))
        .expect(409);
      expect(res.body.message).toBe(
        'A categoria tem produtos vinculados e não pode ser excluída',
      );
    });

    it('CHECK recusa saldo negativo, mesmo sem passar pela API', async () => {
      const { body } = await create().expect(201);
      await expect(
        prisma.$executeRaw`UPDATE products SET current_stock = -1 WHERE id = ${body.id}::uuid`,
      ).rejects.toThrow(/products_current_stock_chk/);
    });
  });
});
