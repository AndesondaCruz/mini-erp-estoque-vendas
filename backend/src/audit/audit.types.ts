// Ações auditadas. É uma união de strings (e não um enum do banco) porque a
// lista cresce a cada fase: um enum no Postgres exigiria uma migration por ação.
// O TypeScript continua impedindo gravar uma ação que não existe.
export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'REFRESH_TOKEN_REUSE'
  | 'PASSWORD_CHANGED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_PRICE_CHANGED'
  | 'PRODUCT_DEACTIVATED'
  | 'PRODUCT_REACTIVATED'
  | 'STOCK_MANUAL_EXIT'
  | 'STOCK_ADJUSTED';

// Campos que podem aparecer em before/after, por entidade.
// Lista de PERMITIDOS: um campo novo (como um hash) fica fora até alguém
// decidir conscientemente incluí-lo.
export const AUDITABLE_FIELDS = {
  User: ['id', 'name', 'email', 'role', 'active'],
  Product: ['id', 'sku', 'name', 'costPrice', 'salePrice', 'active'],
  StockMovement: [
    'id',
    'productId',
    'type',
    'quantity',
    'balanceAfter',
    'reason',
  ],
} as const satisfies Record<string, readonly string[]>;

export type AuditEntity = keyof typeof AUDITABLE_FIELDS;

export interface AuditEntry {
  action: AuditAction;
  userId?: string | null;
  entity?: AuditEntity;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ip?: string;
}
