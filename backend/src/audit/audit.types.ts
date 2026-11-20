// Ações auditadas. É uma união de strings (e não um enum do banco) porque a
// lista cresce a cada fase: um enum no Postgres exigiria uma migration por ação.
// O TypeScript continua impedindo gravar uma ação que não existe.
// É um array (e não só um tipo) porque o filtro de GET /audit-logs precisa da
// lista em tempo de execução para validar; o tipo é derivado dele.
export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'REFRESH_TOKEN_REUSE',
  'PASSWORD_CHANGED',
  'ACCESS_DENIED',
  'USER_CREATED',
  'USER_UPDATED',
  'PRODUCT_CREATED',
  'PRODUCT_PRICE_CHANGED',
  'PRODUCT_DEACTIVATED',
  'PRODUCT_REACTIVATED',
  'STOCK_MANUAL_EXIT',
  'STOCK_ADJUSTED',
  'SALE_CREATED',
  'SALE_CANCELED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Campos que podem aparecer em before/after, por entidade.
// Lista de PERMITIDOS: um campo novo (como um hash) fica fora até alguém
// decidir conscientemente incluí-lo.
export const AUDITABLE_FIELDS = {
  User: ['id', 'name', 'email', 'role', 'active'],
  Product: ['id', 'sku', 'name', 'costPrice', 'salePrice', 'active'],
  Sale: [
    'id',
    'number',
    'sellerId',
    'total',
    'status',
    'items',
    'canceledAt',
    'canceledById',
    'cancelReason',
  ],
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
export const AUDIT_ENTITIES = Object.keys(AUDITABLE_FIELDS) as AuditEntity[];

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
