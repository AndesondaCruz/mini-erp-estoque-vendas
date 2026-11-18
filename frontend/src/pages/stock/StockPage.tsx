import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
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
import type {
  Paginated,
  Product,
  StockMovement,
  StockMovementType,
} from '../../lib/types';
import { MOVEMENT_LABELS } from '../../lib/types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = Object.keys(MOVEMENT_LABELS) as StockMovementType[];

/** Lê um parâmetro da URL e só aceita se estiver na lista. */
function pick<T extends string>(value: string | null, allowed: readonly T[]) {
  return allowed.find((item) => item === value);
}

export function StockPage() {
  const list = useListParams(['createdAt'] as const, 'createdAt');
  const productId = list.get('produto');
  const type = pick(list.get('tipo'), TYPES);
  const from = DATE_PATTERN.test(list.get('de') ?? '') ? list.get('de')! : '';
  const to = DATE_PATTERN.test(list.get('ate') ?? '') ? list.get('ate')! : '';
  // Extrato: o mais recente primeiro, como o padrão da API.
  const order = list.get('ordem') === 'asc' ? 'asc' : 'desc';

  const product = useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: () => api<Product>(`/products/${productId}`),
    enabled: productId !== null,
  });

  const params = {
    page: list.page,
    order,
    type,
    from: from ? startOfDayIso(from) : undefined,
    to: to ? endOfDayExclusiveIso(to) : undefined,
  };
  const query = useQuery({
    queryKey: ['stock-movements', productId, params],
    // Com produto, o extrato dele (404 se não existir); sem, o geral.
    queryFn: () =>
      api<Paginated<StockMovement>>(
        productId ? `/products/${productId}/movements` : '/stock/movements',
        { query: params },
      ),
    placeholderData: keepPreviousData,
  });

  const newMovementLink = productId
    ? `/estoque/nova?produto=${productId}`
    : '/estoque/nova';

  return (
    <section aria-labelledby="titulo-estoque" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="titulo-estoque" className="text-2xl font-semibold">
          Movimentações de estoque
        </h1>
        <Link to={newMovementLink} className={primaryButton}>
          Nova movimentação
        </Link>
      </div>

      {productId && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm">
          <span>
            Produto:{' '}
            <strong>
              {product.data
                ? `${product.data.sku} - ${product.data.name} (saldo ${product.data.currentStock})`
                : product.isError
                  ? 'produto não encontrado'
                  : 'carregando...'}
            </strong>
          </span>
          <button
            type="button"
            className={linkButton}
            onClick={() => list.update({ produto: null })}
          >
            Ver todos os produtos
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label
            htmlFor="filtro-tipo"
            className="mb-1 block text-sm font-medium"
          >
            Tipo
          </label>
          <select
            id="filtro-tipo"
            value={type ?? ''}
            onChange={(e) => list.update({ tipo: e.target.value })}
            className={inputClass}
          >
            <option value="">Todos</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {MOVEMENT_LABELS[value]}
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

      {query.isPending && <Spinner label="Carregando movimentações" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white text-left text-sm">
              <caption className="sr-only">Movimentações de estoque</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <SortableHeader
                    field="createdAt"
                    label="Data"
                    sort="createdAt"
                    order={order}
                    onSort={() =>
                      list.update({ ordem: order === 'desc' ? 'asc' : null })
                    }
                  />
                  <th scope="col" className="px-3 py-2">
                    Produto
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Tipo
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Quantidade
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Saldo depois
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Motivo
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Responsável
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center">
                      Nenhuma movimentação encontrada.
                    </td>
                  </tr>
                )}
                {query.data.data.map((movement) => (
                  <tr key={movement.id} className="border-b border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(movement.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {productId ? (
                        movement.product.name
                      ) : (
                        <button
                          type="button"
                          className={linkButton}
                          aria-label={`Ver movimentações de ${movement.product.name}`}
                          onClick={() =>
                            list.update({ produto: movement.product.id })
                          }
                        >
                          {movement.product.name}
                        </button>
                      )}
                      <span className="block font-mono text-xs text-slate-600">
                        {movement.product.sku}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {MOVEMENT_LABELS[movement.type]}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        movement.quantity < 0
                          ? 'text-red-700'
                          : 'text-green-800'
                      }`}
                    >
                      {/* Sinal explícito: a cor sozinha não informa. */}
                      {movement.quantity > 0
                        ? `+${movement.quantity}`
                        : movement.quantity}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {movement.balanceAfter}
                    </td>
                    <td className="px-3 py-2">{movement.reason ?? '-'}</td>
                    <td className="px-3 py-2">{movement.user.name}</td>
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
