import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Pagination } from '../../components/Pagination';
import { SortableHeader } from '../../components/SortableHeader';
import { Spinner } from '../../components/Spinner';
import { inputClass, linkButton, primaryButton } from '../../components/ui';
import { api } from '../../lib/api';
import {
  endOfDayExclusiveIso,
  formatDateTime,
  startOfDayIso,
} from '../../lib/dates';
import { useListParams } from '../../lib/list-params';
import { formatMoney } from '../../lib/money';
import type { Paginated, Sale, SaleStatus } from '../../lib/types';
import { SALE_SORT_FIELDS, SALE_STATUS_LABELS } from '../../lib/types';
import { SaleStatusBadge } from './SaleStatusBadge';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = Object.keys(SALE_STATUS_LABELS) as SaleStatus[];

/** Data da URL só se tiver o formato do <input type="date">. */
const validDate = (value: string | null) =>
  value !== null && DATE_PATTERN.test(value) ? value : '';

export function SalesPage() {
  const { user } = useAuth();
  // Vendas abrem da mais recente para a mais antiga.
  const list = useListParams(SALE_SORT_FIELDS, 'createdAt', 'desc');
  const status = STATUSES.find((value) => value === list.get('status'));
  const from = validDate(list.get('de'));
  const to = validDate(list.get('ate'));

  const params = {
    page: list.page,
    sort: list.sort,
    order: list.order,
    status,
    from: from ? startOfDayIso(from) : undefined,
    to: to ? endOfDayExclusiveIso(to) : undefined,
  };
  const query = useQuery({
    queryKey: ['sales', 'list', params],
    queryFn: ({ signal }) =>
      api<Paginated<Sale>>('/sales', { query: params, signal }),
    placeholderData: keepPreviousData,
  });

  const header = (field: (typeof SALE_SORT_FIELDS)[number], label: string) => (
    <SortableHeader
      field={field}
      label={label}
      sort={list.sort}
      order={list.order}
      onSort={list.toggleSort}
      className={field === 'total' ? 'text-right' : ''}
    />
  );

  return (
    <section aria-labelledby="titulo-vendas" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="titulo-vendas" className="text-2xl font-semibold">
          Vendas
        </h1>
        <Link to="/vendas/nova" className={primaryButton}>
          Nova venda
        </Link>
      </div>
      {user?.role === 'VENDEDOR' && (
        <p className="text-sm text-slate-600">
          Aqui aparecem só as vendas que você registrou.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label
            htmlFor="filtro-status"
            className="mb-1 block text-sm font-medium"
          >
            Situação
          </label>
          <select
            id="filtro-status"
            value={status ?? ''}
            onChange={(e) => list.update({ status: e.target.value })}
            className={inputClass}
          >
            <option value="">Todas</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {SALE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filtro-de" className="mb-1 block text-sm font-medium">
            De
          </label>
          <input
            id="filtro-de"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => list.update({ de: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="filtro-ate"
            className="mb-1 block text-sm font-medium"
          >
            Até (inclusive)
          </label>
          <input
            id="filtro-ate"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => list.update({ ate: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      {query.isPending && <Spinner label="Carregando vendas" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white text-left text-sm">
              <caption className="sr-only">Vendas</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {header('number', 'Número')}
                  {header('createdAt', 'Data')}
                  <th scope="col" className="px-3 py-2">
                    Vendedor
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Itens
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Situação
                  </th>
                  {header('total', 'Total')}
                </tr>
              </thead>
              <tbody>
                {query.data.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center">
                      Nenhuma venda encontrada.
                    </td>
                  </tr>
                )}
                {query.data.data.map((sale) => (
                  <tr key={sale.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        to={`/vendas/${sale.id}`}
                        className={linkButton}
                        aria-label={`Ver venda nº ${sale.number}`}
                      >
                        nº {sale.number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(sale.createdAt)}
                    </td>
                    <td className="px-3 py-2">{sale.seller.name}</td>
                    <td className="px-3 py-2 text-right">
                      {sale.items.reduce((sum, item) => sum + item.quantity, 0)}
                    </td>
                    <td className="px-3 py-2">
                      <SaleStatusBadge status={sale.status} />
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right font-medium ${
                        sale.status === 'CANCELADA'
                          ? 'text-slate-500 line-through'
                          : ''
                      }`}
                    >
                      {formatMoney(sale.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            meta={query.data.meta}
            onPageChange={(page) => list.update({ page })}
          />
        </>
      )}
    </section>
  );
}
