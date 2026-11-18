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

// Espelham as listas permitidas dos DTOs de listagem do back-end.
export const PRODUCT_SORT_FIELDS = [
  'name',
  'sku',
  'salePrice',
  'currentStock',
  'createdAt',
] as const;
export const NAME_SORT_FIELDS = ['name', 'createdAt'] as const;

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  VENDEDOR: 'Vendedor',
};
