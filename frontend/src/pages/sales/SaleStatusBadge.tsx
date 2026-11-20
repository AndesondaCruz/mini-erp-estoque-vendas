import type { SaleStatus } from '../../lib/types';
import { SALE_STATUS_LABELS } from '../../lib/types';

const COLORS: Record<SaleStatus, string> = {
  CONCLUIDA: 'border-green-200 bg-green-50 text-green-800',
  CANCELADA: 'border-red-200 bg-red-50 text-red-800',
};

/** Situação da venda. O texto informa; a cor só reforça. */
export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${COLORS[status]}`}
    >
      {SALE_STATUS_LABELS[status]}
    </span>
  );
}
