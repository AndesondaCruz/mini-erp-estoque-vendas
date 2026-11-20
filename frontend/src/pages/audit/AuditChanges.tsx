import { formatDateTime } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import type { AuditLog, Role } from '../../lib/types';
import { ROLE_LABELS } from '../../lib/types';

// Nomes em português dos campos que o back-end deixa entrar na auditoria
// (AUDITABLE_FIELDS) e das chaves de metadata. Campo sem nome aqui aparece
// com a chave original: nada some da tela.
const FIELD_LABELS: Record<string, string> = {
  id: 'Id',
  name: 'Nome',
  email: 'E-mail',
  role: 'Papel',
  active: 'Situação',
  sku: 'SKU',
  costPrice: 'Preço de custo',
  salePrice: 'Preço de venda',
  number: 'Número',
  sellerId: 'Vendedor (id)',
  total: 'Total',
  status: 'Status',
  items: 'Itens',
  canceledAt: 'Cancelada em',
  canceledById: 'Cancelada por (id)',
  cancelReason: 'Motivo do cancelamento',
  productId: 'Produto (id)',
  type: 'Tipo',
  quantity: 'Quantidade',
  balanceAfter: 'Saldo depois',
  reason: 'Motivo',
  method: 'Método',
  route: 'Rota',
  requiredRoles: 'Papéis exigidos',
};
const MONEY_FIELDS = new Set(['costPrice', 'salePrice', 'total']);
const DATE_FIELDS = new Set(['canceledAt']);
const ROLE_FIELDS = new Set(['role', 'requiredRoles']);

const label = (key: string) => FIELD_LABELS[key] ?? key;

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && value in ROLE_LABELS;

/** Valor de auditoria -> texto legível, conforme o campo. */
export function formatAuditValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  if (key === 'active' && typeof value === 'boolean') {
    return value ? 'Ativo' : 'Inativo';
  }
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (ROLE_FIELDS.has(key) && isRole(value)) return ROLE_LABELS[value];
    if (MONEY_FIELDS.has(key)) return formatMoney(value);
    if (DATE_FIELDS.has(key)) return formatDateTime(value);
    return value;
  }
  // Lista de valores simples (ex.: papéis exigidos): um por um.
  if (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' || typeof v === 'number')
  ) {
    return value.map((v) => formatAuditValue(key, v)).join(', ');
  }
  // Estrutura (ex.: itens da venda): o JSON compacto, sem perder nada.
  return JSON.stringify(value);
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

interface Row {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

/**
 * Junta before e after numa lista de campos. Quando só existe um dos dois
 * (criação, por exemplo), nada é marcado como alterado: não há comparação.
 */
export function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Row[] {
  const keys = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ];
  const compare = before !== null && after !== null;
  return keys.map((key) => ({
    key,
    before: before?.[key],
    after: after?.[key],
    changed: compare && !same(before[key], after[key]),
  }));
}

/** Detalhes de um registro: diferenças de estado e metadata. */
export function AuditChanges({ log }: { log: AuditLog }) {
  const rows = diffRows(log.before, log.after);
  const metadata = Object.entries(log.metadata ?? {});
  const showBefore = log.before !== null;
  const showAfter = log.after !== null;

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Campos do registro antes e depois da ação
          </caption>
          <thead className="border-b border-slate-200">
            <tr>
              <th scope="col" className="px-2 py-1">
                Campo
              </th>
              {showBefore && (
                <th scope="col" className="px-2 py-1">
                  Antes
                </th>
              )}
              {showAfter && (
                <th scope="col" className="px-2 py-1">
                  Depois
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={row.changed ? 'bg-amber-50 font-medium' : ''}
              >
                <th scope="row" className="px-2 py-1 font-normal">
                  {label(row.key)}
                  {/* Mudança dita em texto, não só pela cor de fundo. */}
                  {row.changed && (
                    <span className="ml-2 rounded bg-amber-200 px-1.5 text-xs text-amber-900">
                      alterado
                    </span>
                  )}
                </th>
                {showBefore && (
                  <td className="px-2 py-1">
                    {formatAuditValue(row.key, row.before)}
                  </td>
                )}
                {showAfter && (
                  <td className="px-2 py-1">
                    {formatAuditValue(row.key, row.after)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {metadata.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {metadata.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-slate-600">{label(key)}</dt>
              <dd>{formatAuditValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {log.ip && (
        <p className="text-xs text-slate-600">
          IP: <code>{log.ip}</code>
        </p>
      )}
      {rows.length === 0 && metadata.length === 0 && !log.ip && (
        <p className="text-sm text-slate-600">Sem detalhes registrados.</p>
      )}
    </div>
  );
}
