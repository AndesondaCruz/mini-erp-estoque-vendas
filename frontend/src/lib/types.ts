// Espelha os DTOs da API (backend/src/**/dto). Só o que o front usa.

export type Role = 'ADMIN' | 'GERENTE' | 'VENDEDOR';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Ref {
  id: string;
  name: string;
}

export type Category = Ref;

export interface Supplier {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

/** Dinheiro vem como string decimal ("5.50"). costPrice não vem para VENDEDOR. */
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: Ref;
  supplier: Ref | null;
  costPrice?: string;
  salePrice: string;
  minStock: number;
  currentStock: number;
  lowStock: boolean;
  active: boolean;
}

export type StockMovementType = 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'ESTORNO';
/** ESTORNO só nasce do cancelamento de venda: não é lançado à mão. */
export type ManualMovementType = Exclude<StockMovementType, 'ESTORNO'>;

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  AJUSTE: 'Ajuste',
  ESTORNO: 'Estorno de venda',
};

export interface StockMovement {
  id: string;
  product: { id: string; sku: string; name: string };
  type: StockMovementType;
  /** Com sinal: negativo é saída. */
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  user: Ref;
  createdAt: string;
}

export interface StockAlert {
  id: string;
  sku: string;
  name: string;
  category: Ref;
  currentStock: number;
  minStock: number;
  /** minStock - currentStock */
  shortage: number;
}

export type SaleStatus = 'CONCLUIDA' | 'CANCELADA';

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

/** Preço e custo gravados na hora da venda. unitCost não vem para VENDEDOR. */
export interface SaleItem {
  product: { id: string; sku: string; name: string };
  quantity: number;
  unitPrice: string;
  unitCost?: string;
  subtotal: string;
}

export interface Sale {
  id: string;
  number: number;
  seller: Ref;
  status: SaleStatus;
  total: string;
  items: SaleItem[];
  createdAt: string;
  canceledAt: string | null;
  canceledBy: Ref | null;
  cancelReason: string | null;
}

/** Limites do CreateSaleDto (MAX_SALE_ITEMS e MAX_STOCK). */
export const MAX_SALE_ITEMS = 50;
export const MAX_QUANTITY = 1_000_000;

// Relatórios. Datas de calendário (AAAA-MM-DD) no fuso da loja.
export type GroupBy = 'day' | 'week' | 'month';

export interface SalesReport {
  from: string;
  to: string;
  groupBy: GroupBy;
  timezone: string;
  /** Um por período, inclusive os sem venda (zerados). period = início. */
  rows: { period: string; sales: number; revenue: string }[];
  totalSales: number;
  totalRevenue: string;
  /** null quando não há vendas. */
  averageTicket: string | null;
}

export interface TopProduct {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  revenue: string;
}

export interface StockValueCategory {
  categoryId: string;
  categoryName: string;
  /** Produtos com saldo. */
  products: number;
  /** Dos quais desativados. */
  inactiveProducts: number;
  units: number;
  costValue: string;
  saleValue: string;
}

export interface StockValue {
  categories: StockValueCategory[];
  totalUnits: number;
  totalCostValue: string;
  totalSaleValue: string;
}

/** Limite de período da API (MAX_RANGE_DAYS). */
export const MAX_REPORT_DAYS = 366;

// Espelham as listas permitidas dos DTOs de listagem do back-end.
export const SALE_SORT_FIELDS = ['createdAt', 'number', 'total'] as const;
export const PRODUCT_SORT_FIELDS = [
  'name',
  'sku',
  'salePrice',
  'currentStock',
  'createdAt',
] as const;
export const NAME_SORT_FIELDS = ['name', 'createdAt'] as const;
export const USER_SORT_FIELDS = ['name', 'email', 'role'] as const;

export const ROLES: Role[] = ['ADMIN', 'GERENTE', 'VENDEDOR'];

// Auditoria. Espelha AUDIT_ACTIONS e AUDITABLE_FIELDS do back-end
// (backend/src/audit/audit.types.ts).
export const AUDIT_ACTION_LABELS = {
  LOGIN_SUCCESS: 'Login',
  LOGIN_FAILED: 'Login recusado',
  LOGOUT: 'Saída',
  REFRESH_TOKEN_REUSE: 'Reuso de sessão (sessões encerradas)',
  PASSWORD_CHANGED: 'Senha trocada',
  ACCESS_DENIED: 'Acesso negado',
  USER_CREATED: 'Usuário criado',
  USER_UPDATED: 'Usuário alterado',
  PRODUCT_CREATED: 'Produto criado',
  PRODUCT_PRICE_CHANGED: 'Preço alterado',
  PRODUCT_DEACTIVATED: 'Produto desativado',
  PRODUCT_REACTIVATED: 'Produto reativado',
  STOCK_MANUAL_EXIT: 'Saída manual de estoque',
  STOCK_ADJUSTED: 'Ajuste de estoque',
  SALE_CREATED: 'Venda registrada',
  SALE_CANCELED: 'Venda cancelada',
} as const;
export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;

export const AUDIT_ENTITY_LABELS = {
  User: 'Usuário',
  Product: 'Produto',
  Sale: 'Venda',
  StockMovement: 'Movimentação de estoque',
} as const;
export type AuditEntity = keyof typeof AUDIT_ENTITY_LABELS;

export interface AuditLog {
  id: string;
  action: AuditAction;
  /** null em login com e-mail inexistente. */
  user: { id: string; name: string; email: string } | null;
  entity: AuditEntity | null;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  VENDEDOR: 'Vendedor',
};
