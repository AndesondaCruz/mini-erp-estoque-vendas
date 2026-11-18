import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type {
  AuthResponse,
  Category,
  Product,
  Role,
  StockMovement,
  Supplier,
  User,
} from '../lib/types';

/**
 * API falsa para os testes. `session` imita o cookie de refresh: quando há
 * um usuário nela, POST /auth/refresh devolve uma sessão nova.
 */
export const mockState: {
  session: User | null;
  validToken: string | null;
  refreshCalls: number;
  password: string;
} = {
  session: null,
  validToken: null,
  refreshCalls: 0,
  password: 'senha-certa',
};

export function makeUser(role: Role = 'VENDEDOR'): User {
  return {
    id: `${role.toLowerCase()}-1`,
    name: `Pessoa ${role}`,
    email: `${role.toLowerCase()}@loja.com`,
    role,
    active: true,
  };
}

let tokenCounter = 0;
function issue(user: User): AuthResponse {
  mockState.session = user;
  mockState.validToken = `token-${++tokenCounter}`;
  return {
    accessToken: mockState.validToken,
    tokenType: 'Bearer',
    expiresIn: 900,
    user,
  };
}

const apiError = (status: number, message: string, details?: unknown) =>
  HttpResponse.json(
    { statusCode: status, message, details, requestId: 'req-teste-123' },
    { status },
  );

const authorized = (request: Request) =>
  mockState.validToken !== null &&
  request.headers.get('Authorization') === `Bearer ${mockState.validToken}`;

export const handlers = [
  http.post('*/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password !== mockState.password) {
      return apiError(401, 'E-mail ou senha inválidos');
    }
    const role = (body.email.split('@')[0].toUpperCase() as Role) ?? 'VENDEDOR';
    return HttpResponse.json(issue({ ...makeUser(role), email: body.email }));
  }),
  http.post('*/api/v1/auth/refresh', () => {
    mockState.refreshCalls++;
    if (!mockState.session) return apiError(401, 'Sessão expirada');
    return HttpResponse.json(issue(mockState.session));
  }),
  http.post('*/api/v1/auth/logout', () => {
    mockState.session = null;
    mockState.validToken = null;
    return new HttpResponse(null, { status: 204 });
  }),
  // Alertas calculados do catálogo, como no back-end: ativos com saldo <=
  // mínimo, pela maior falta.
  http.get('*/api/v1/stock/alerts', ({ request }) => {
    if (!authorized(request)) return apiError(401, 'Token inválido');
    const alerts = catalog.products
      .filter((p) => p.active && p.currentStock <= p.minStock)
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: catalog.categories.find((c) => c.id === p.categoryId)!,
        currentStock: p.currentStock,
        minStock: p.minStock,
        shortage: p.minStock - p.currentStock,
      }))
      .sort((a, b) => b.shortage - a.shortage);
    return HttpResponse.json(
      paginate(alerts, new URL(request.url).searchParams),
    );
  }),
  ...catalogHandlers(),
  ...stockHandlers(),
];

export const server = setupServer(...handlers);

export function resetMockState(): void {
  mockState.session = null;
  mockState.validToken = null;
  mockState.refreshCalls = 0;
  mockState.password = 'senha-certa';
  resetCatalog();
}

// ---------------------------------------------------------------------------
// Catálogo em memória. Imita as regras do back-end que mudam a tela: costPrice
// some para VENDEDOR, só ADMIN desativa produto, categoria em uso não sai.

interface StoredProduct extends Omit<Product, 'category' | 'supplier'> {
  categoryId: string;
  supplierId: string | null;
}

export const catalog: {
  categories: Category[];
  suppliers: Supplier[];
  products: StoredProduct[];
  movements: StockMovement[];
  /** Última query string e último corpo recebidos, para os testes conferirem. */
  lastQuery: URLSearchParams | null;
  /** Último caminho de listagem chamado (ex.: /products/x/movements). */
  lastPath: string | null;
  lastBody: unknown;
} = {
  categories: [],
  suppliers: [],
  products: [],
  movements: [],
  lastPath: null,
  lastQuery: null,
  lastBody: null,
};

function resetCatalog(): void {
  catalog.categories = [
    { id: 'cat-bebidas', name: 'Bebidas' },
    { id: 'cat-limpeza', name: 'Limpeza' },
  ];
  catalog.suppliers = [
    {
      id: 'sup-sertao',
      name: 'Distribuidora Sertão',
      document: '11222333000181',
      phone: '(84) 3333-4444',
      email: 'vendas@sertao.com',
      active: true,
    },
    {
      id: 'sup-antigo',
      name: 'Atacado Antigo',
      document: null,
      phone: null,
      email: null,
      active: false,
    },
  ];
  catalog.products = [
    {
      id: 'prod-cerveja',
      sku: 'CER-350',
      name: 'Cerveja lata 350 ml',
      categoryId: 'cat-bebidas',
      supplierId: 'sup-sertao',
      costPrice: '3.20',
      salePrice: '5.50',
      minStock: 10,
      currentStock: 4,
      lowStock: true,
      active: true,
    },
    {
      id: 'prod-sabao',
      sku: 'SAB-1KG',
      name: 'Sabão em pó 1 kg',
      categoryId: 'cat-limpeza',
      supplierId: null,
      costPrice: '9.90',
      salePrice: '14.90',
      minStock: 2,
      currentStock: 20,
      lowStock: false,
      active: true,
    },
  ];
  catalog.movements = [
    {
      id: 'mov-1',
      product: {
        id: 'prod-cerveja',
        sku: 'CER-350',
        name: 'Cerveja lata 350 ml',
      },
      type: 'ENTRADA',
      quantity: 4,
      balanceAfter: 4,
      reason: null,
      user: { id: 'gerente-1', name: 'Pessoa GERENTE' },
      createdAt: '2026-11-10T12:00:00.000Z',
    },
    {
      id: 'mov-2',
      product: { id: 'prod-sabao', sku: 'SAB-1KG', name: 'Sabão em pó 1 kg' },
      type: 'SAIDA',
      quantity: -2,
      balanceAfter: 20,
      reason: 'Embalagem rasgada',
      user: { id: 'admin-1', name: 'Pessoa ADMIN' },
      createdAt: '2026-11-15T12:00:00.000Z',
    },
  ];
  catalog.lastQuery = null;
  catalog.lastPath = null;
  catalog.lastBody = null;
}
resetCatalog();

function toProduct(stored: StoredProduct): Product {
  const { categoryId, supplierId, costPrice, ...rest } = stored;
  const category = catalog.categories.find((c) => c.id === categoryId)!;
  const supplier = catalog.suppliers.find((s) => s.id === supplierId);
  return {
    ...rest,
    category: { id: category.id, name: category.name },
    supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
    // Igual ao back-end: a chave nem existe para o VENDEDOR.
    ...(mockState.session?.role !== 'VENDEDOR' && { costPrice }),
  };
}

function paginate<T>(items: T[], query: URLSearchParams) {
  const page = Number(query.get('page') ?? 1);
  const pageSize = Number(query.get('pageSize') ?? 20);
  return {
    data: items.slice((page - 1) * pageSize, page * pageSize),
    meta: {
      page,
      pageSize,
      total: items.length,
      totalPages: Math.ceil(items.length / pageSize),
    },
  };
}

const matches = (text: string, search: string | null) =>
  !search || text.toLowerCase().includes(search.toLowerCase());

function activeFilter(query: URLSearchParams) {
  const active = query.get('active');
  return (item: { active: boolean }) =>
    active === null || item.active === (active === 'true');
}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-novo-${++idCounter}`;

function catalogHandlers() {
  /** Guarda de autenticação e de papel, como o JwtAuthGuard + RolesGuard. */
  const guard = (request: Request, roles?: Role[]) => {
    if (!authorized(request)) return apiError(401, 'Token inválido');
    if (roles && !roles.includes(mockState.session!.role)) {
      return apiError(403, 'Você não tem permissão para esta ação');
    }
    return null;
  };
  const MANAGERS: Role[] = ['ADMIN', 'GERENTE'];
  const query = (request: Request) => {
    catalog.lastQuery = new URL(request.url).searchParams;
    return catalog.lastQuery;
  };
  const body = async <T>(request: Request) => {
    catalog.lastBody = await request.json();
    return catalog.lastBody as T;
  };

  return [
    // Categorias
    http.get('*/api/v1/categories', ({ request }) => {
      const denied = guard(request);
      if (denied) return denied;
      const q = query(request);
      const items = catalog.categories.filter((c) =>
        matches(c.name, q.get('search')),
      );
      return HttpResponse.json(paginate(items, q));
    }),
    http.post('*/api/v1/categories', async ({ request }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const { name } = await body<{ name: string }>(request);
      if (catalog.categories.some((c) => c.name === name)) {
        return apiError(409, 'Já existe uma categoria com esse nome');
      }
      const category = { id: newId('cat'), name };
      catalog.categories.push(category);
      return HttpResponse.json(category, { status: 201 });
    }),
    http.patch('*/api/v1/categories/:id', async ({ request, params }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const category = catalog.categories.find((c) => c.id === params.id);
      if (!category) return apiError(404, 'Categoria não encontrada');
      category.name = (await body<{ name: string }>(request)).name;
      return HttpResponse.json(category);
    }),
    http.delete('*/api/v1/categories/:id', ({ request, params }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      if (catalog.products.some((p) => p.categoryId === params.id)) {
        return apiError(
          409,
          'A categoria tem produtos vinculados e não pode ser excluída',
        );
      }
      catalog.categories = catalog.categories.filter((c) => c.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),

    // Fornecedores
    http.get('*/api/v1/suppliers', ({ request }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const q = query(request);
      const items = catalog.suppliers
        .filter(activeFilter(q))
        .filter((s) => matches(s.name, q.get('search')));
      return HttpResponse.json(paginate(items, q));
    }),
    http.get('*/api/v1/suppliers/:id', ({ request, params }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const supplier = catalog.suppliers.find((s) => s.id === params.id);
      if (!supplier) return apiError(404, 'Fornecedor não encontrado');
      return HttpResponse.json(supplier);
    }),
    http.post('*/api/v1/suppliers', async ({ request }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const data = await body<Omit<Supplier, 'id' | 'active'>>(request);
      const supplier = { id: newId('sup'), active: true, ...data };
      catalog.suppliers.push(supplier);
      return HttpResponse.json(supplier, { status: 201 });
    }),
    http.patch('*/api/v1/suppliers/:id', async ({ request, params }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const supplier = catalog.suppliers.find((s) => s.id === params.id);
      if (!supplier) return apiError(404, 'Fornecedor não encontrado');
      Object.assign(supplier, await body<Partial<Supplier>>(request));
      return HttpResponse.json(supplier);
    }),
    http.delete('*/api/v1/suppliers/:id', ({ request, params }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const supplier = catalog.suppliers.find((s) => s.id === params.id);
      if (!supplier) return apiError(404, 'Fornecedor não encontrado');
      supplier.active = false;
      return new HttpResponse(null, { status: 204 });
    }),

    // Produtos
    http.get('*/api/v1/products', ({ request }) => {
      const denied = guard(request);
      if (denied) return denied;
      const q = query(request);
      const isSeller = mockState.session!.role === 'VENDEDOR';
      const items = catalog.products
        .filter(isSeller ? (p) => p.active : activeFilter(q))
        .filter(
          (p) =>
            matches(p.name, q.get('search')) || matches(p.sku, q.get('search')),
        )
        .filter(
          (p) => !q.get('categoryId') || p.categoryId === q.get('categoryId'),
        )
        .filter((p) => q.get('lowStock') !== 'true' || p.lowStock);
      return HttpResponse.json(paginate(items.map(toProduct), q));
    }),
    http.get('*/api/v1/products/:id', ({ request, params }) => {
      const denied = guard(request);
      if (denied) return denied;
      const product = catalog.products.find((p) => p.id === params.id);
      if (!product) return apiError(404, 'Produto não encontrado');
      return HttpResponse.json(toProduct(product));
    }),
    http.post('*/api/v1/products', async ({ request }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const data =
        await body<
          Omit<StoredProduct, 'id' | 'active' | 'currentStock' | 'lowStock'>
        >(request);
      if (catalog.products.some((p) => p.sku === data.sku)) {
        return apiError(409, 'SKU já cadastrado');
      }
      const product: StoredProduct = {
        id: newId('prod'),
        ...data,
        currentStock: 0,
        lowStock: 0 <= data.minStock,
        active: true,
      };
      catalog.products.push(product);
      return HttpResponse.json(toProduct(product), { status: 201 });
    }),
    http.patch('*/api/v1/products/:id', async ({ request, params }) => {
      const denied = guard(request, MANAGERS);
      if (denied) return denied;
      const product = catalog.products.find((p) => p.id === params.id);
      if (!product) return apiError(404, 'Produto não encontrado');
      const data = await body<Partial<StoredProduct>>(request);
      if (data.active !== undefined && mockState.session!.role !== 'ADMIN') {
        return apiError(403, 'Só o ADMIN pode ativar ou desativar produtos');
      }
      Object.assign(product, data);
      return HttpResponse.json(toProduct(product));
    }),
    http.delete('*/api/v1/products/:id', ({ request, params }) => {
      const denied = guard(request, ['ADMIN']);
      if (denied) return denied;
      const product = catalog.products.find((p) => p.id === params.id);
      if (!product) return apiError(404, 'Produto não encontrado');
      product.active = false;
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

// ---------------------------------------------------------------------------
// Movimentações. Mesmas regras do StockService: saída não passa do saldo
// (409 com details.available), produto inativo não tem saída, ajuste sem
// diferença é 400. O saldo do produto muda junto.

function stockHandlers() {
  const MANAGERS: Role[] = ['ADMIN', 'GERENTE'];
  const guard = (request: Request) => {
    if (!authorized(request)) return apiError(401, 'Token inválido');
    if (!MANAGERS.includes(mockState.session!.role)) {
      return apiError(403, 'Você não tem permissão para esta ação');
    }
    return null;
  };

  function list(request: Request, productId?: string) {
    const url = new URL(request.url);
    catalog.lastQuery = url.searchParams;
    catalog.lastPath = url.pathname.replace('/api/v1', '');
    const q = url.searchParams;
    const from = q.get('from');
    const to = q.get('to');
    const items = catalog.movements
      .filter((m) => !productId || m.product.id === productId)
      .filter((m) => !q.get('type') || m.type === q.get('type'))
      .filter((m) => !from || m.createdAt >= new Date(from).toISOString())
      .filter((m) => !to || m.createdAt < new Date(to).toISOString())
      .sort((a, b) =>
        q.get('order') === 'asc'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
      );
    return HttpResponse.json(paginate(items, q));
  }

  return [
    http.get('*/api/v1/stock/movements', ({ request }) => {
      return guard(request) ?? list(request);
    }),
    http.get('*/api/v1/products/:id/movements', ({ request, params }) => {
      const denied = guard(request);
      if (denied) return denied;
      if (!catalog.products.some((p) => p.id === params.id)) {
        return apiError(404, 'Produto não encontrado');
      }
      return list(request, params.id as string);
    }),
    http.post('*/api/v1/stock/movements', async ({ request }) => {
      const denied = guard(request);
      if (denied) return denied;
      const dto = (await request.json()) as {
        productId: string;
        type: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
        quantity?: number;
        countedStock?: number;
        reason?: string;
      };
      catalog.lastBody = dto;
      const product = catalog.products.find((p) => p.id === dto.productId);
      if (!product) return apiError(404, 'Produto não encontrado');

      let delta: number;
      if (dto.type === 'ENTRADA') {
        delta = dto.quantity!;
      } else if (dto.type === 'SAIDA') {
        if (!product.active) {
          return apiError(409, 'Produto inativo não pode ter saída');
        }
        if (dto.quantity! > product.currentStock) {
          return apiError(409, 'Estoque insuficiente', {
            productId: product.id,
            requested: dto.quantity,
            available: product.currentStock,
          });
        }
        delta = -dto.quantity!;
      } else {
        delta = dto.countedStock! - product.currentStock;
        if (delta === 0) {
          return apiError(
            400,
            `O saldo já é ${dto.countedStock}: não há diferença para ajustar`,
          );
        }
      }

      product.currentStock += delta;
      product.lowStock = product.currentStock <= product.minStock;
      const movement: StockMovement = {
        id: newId('mov'),
        product: { id: product.id, sku: product.sku, name: product.name },
        type: dto.type,
        quantity: delta,
        balanceAfter: product.currentStock,
        reason: dto.reason ?? null,
        user: { id: mockState.session!.id, name: mockState.session!.name },
        createdAt: new Date().toISOString(),
      };
      catalog.movements.push(movement);
      return HttpResponse.json(movement, { status: 201 });
    }),
  ];
}
