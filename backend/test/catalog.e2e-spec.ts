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

describe('Catálogo: categorias e fornecedores (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = {} as Record<Role, string>;

  const http = () => request(app.getHttpServer());
  const as = (role: Role) => ({ Authorization: `Bearer ${tokens[role]}` });

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
    await prisma.$executeRawUnsafe('TRUNCATE TABLE categories, suppliers');
  });

  describe('matriz de permissões', () => {
    it('sem token: 401', async () => {
      await http().get('/api/v1/categories').expect(401);
      await http().get('/api/v1/suppliers').expect(401);
    });

    it('VENDEDOR lê categorias, mas não altera (403)', async () => {
      await http().get('/api/v1/categories').set(as('VENDEDOR')).expect(200);
      await http()
        .post('/api/v1/categories')
        .set(as('VENDEDOR'))
        .send({ name: 'Bebidas' })
        .expect(403);
    });

    it('VENDEDOR não acessa fornecedores, nem para ler (403)', async () => {
      await http().get('/api/v1/suppliers').set(as('VENDEDOR')).expect(403);
      await http()
        .post('/api/v1/suppliers')
        .set(as('VENDEDOR'))
        .send({ name: 'X' })
        .expect(403);
    });

    it.each(['ADMIN', 'GERENTE'] as const)(
      '%s cria categoria e fornecedor',
      async (role) => {
        await http()
          .post('/api/v1/categories')
          .set(as(role))
          .send({ name: `Categoria ${role}` })
          .expect(201);
        await http()
          .post('/api/v1/suppliers')
          .set(as(role))
          .send({ name: `Fornecedor ${role}` })
          .expect(201);
      },
    );
  });

  describe('categorias', () => {
    const create = (name: string) =>
      http().post('/api/v1/categories').set(as('GERENTE')).send({ name });

    it('guarda o nome como digitado (sem espaços nas pontas)', async () => {
      const res = await create('  Bebidas  ').expect(201);
      expect(res.body).toEqual({ id: expect.any(String), name: 'Bebidas' });
    });

    it('nome repetido com outra capitalização: 409', async () => {
      await create('Bebidas').expect(201);
      const res = await create('BEBIDAS').expect(409);
      expect(res.body.message).toBe('Já existe uma categoria com esse nome');
    });

    it('nome vazio ou só com espaços: 400', async () => {
      await create('   ').expect(400);
    });

    it('lista com busca e ordenação; campo de ordenação fora da lista: 400', async () => {
      for (const name of ['Limpeza', 'Bebidas', 'Bebidas Quentes']) {
        await create(name).expect(201);
      }
      const res = await http()
        .get('/api/v1/categories?search=beb&sort=name&order=desc')
        .set(as('VENDEDOR'))
        .expect(200);
      expect(res.body.data.map((c: { name: string }) => c.name)).toEqual([
        'Bebidas Quentes',
        'Bebidas',
      ]);
      expect(res.body.meta.total).toBe(2);

      await http()
        .get('/api/v1/categories?sort=id')
        .set(as('VENDEDOR'))
        .expect(400);
    });

    it('renomeia; id inexistente: 404', async () => {
      const { body } = await create('Bebida').expect(201);
      await http()
        .patch(`/api/v1/categories/${body.id}`)
        .set(as('ADMIN'))
        .send({ name: 'Bebidas' })
        .expect(200, { id: body.id, name: 'Bebidas' });
      await http()
        .patch(`/api/v1/categories/${crypto.randomUUID()}`)
        .set(as('ADMIN'))
        .send({ name: 'Outra' })
        .expect(404);
    });

    it('exclui (204); excluir de novo: 404', async () => {
      const { body } = await create('Temporária').expect(201);
      await http()
        .delete(`/api/v1/categories/${body.id}`)
        .set(as('GERENTE'))
        .expect(204);
      await http()
        .delete(`/api/v1/categories/${body.id}`)
        .set(as('GERENTE'))
        .expect(404);
    });
  });

  describe('fornecedores', () => {
    const create = (body: Record<string, unknown>) =>
      http().post('/api/v1/suppliers').set(as('GERENTE')).send(body);

    it('aceita CNPJ alfanumérico com máscara e grava normalizado', async () => {
      const res = await create({
        name: 'Distribuidora Sertão',
        document: '12.abc.345/01de-35',
        email: ' Vendas@Sertao.com ',
      }).expect(201);
      expect(res.body).toMatchObject({
        document: '12ABC34501DE35',
        email: 'vendas@sertao.com',
        phone: null,
        active: true,
      });
    });

    it('CNPJ com dígito verificador errado: 400', async () => {
      const res = await create({
        name: 'X',
        document: '11.222.333/0001-82',
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('CNPJ válido');
    });

    it('mesmo CNPJ com e sem máscara: 409', async () => {
      await create({ name: 'A', document: '11222333000181' }).expect(201);
      await create({ name: 'B', document: '11.222.333/0001-81' }).expect(409);
    });

    it('vários fornecedores sem CNPJ convivem', async () => {
      await create({ name: 'Sem CNPJ 1' }).expect(201);
      await create({ name: 'Sem CNPJ 2' }).expect(201);
    });

    it('PATCH: null apaga, ausente mantém, corpo vazio é 400', async () => {
      const { body } = await create({
        name: 'Fornecedor',
        phone: '(84) 3333-4444',
        email: 'contato@f.com',
      }).expect(201);

      const res = await http()
        .patch(`/api/v1/suppliers/${body.id}`)
        .set(as('ADMIN'))
        .send({ phone: null })
        .expect(200);
      expect(res.body).toMatchObject({ phone: null, email: 'contato@f.com' });

      await http()
        .patch(`/api/v1/suppliers/${body.id}`)
        .set(as('ADMIN'))
        .send({})
        .expect(400);
    });

    it('DELETE desativa sem apagar; filtro por status; PATCH reativa', async () => {
      const { body } = await create({ name: 'Antigo' }).expect(201);
      await create({ name: 'Atual' }).expect(201);

      await http()
        .delete(`/api/v1/suppliers/${body.id}`)
        .set(as('GERENTE'))
        .expect(204);
      await http()
        .get(`/api/v1/suppliers/${body.id}`)
        .set(as('GERENTE'))
        .expect(200)
        .expect((res) => expect(res.body.active).toBe(false));

      const inactive = await http()
        .get('/api/v1/suppliers?active=false')
        .set(as('GERENTE'))
        .expect(200);
      expect(inactive.body.data.map((s: { name: string }) => s.name)).toEqual([
        'Antigo',
      ]);

      await http()
        .patch(`/api/v1/suppliers/${body.id}`)
        .set(as('GERENTE'))
        .send({ active: true })
        .expect(200)
        .expect((res) => expect(res.body.active).toBe(true));
    });

    it('busca por CNPJ digitado com máscara', async () => {
      await create({ name: 'Alvo', document: '11222333000181' }).expect(201);
      await create({ name: 'Outro' }).expect(201);
      const res = await http()
        .get(`/api/v1/suppliers?search=${encodeURIComponent('11.222.333')}`)
        .set(as('ADMIN'))
        .expect(200);
      expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
        'Alvo',
      ]);
    });
  });

  describe('regras no banco (última barreira)', () => {
    it('CHECK recusa CNPJ fora do formato, mesmo sem passar pela API', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO suppliers (id, name, document, updated_at)
          VALUES (gen_random_uuid(), 'Direto no banco', '11.222.333/00', now())`,
      ).rejects.toThrow(/suppliers_document_format_chk/);
    });

    it('UNIQUE do citext recusa categoria repetida, mesmo sem passar pela API', async () => {
      await prisma.category.create({ data: { name: 'Frios' } });
      await expect(
        prisma.category.create({ data: { name: 'FRIOS' } }),
      ).rejects.toThrow();
    });
  });
});
