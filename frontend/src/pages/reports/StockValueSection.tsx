import { useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import type { StockValue } from '../../lib/types';

/** Posição atual do estoque: não depende do período escolhido. */
export function StockValueSection() {
  const query = useQuery({
    queryKey: ['reports', 'stock-value'],
    queryFn: ({ signal }) =>
      api<StockValue>('/reports/stock-value', { signal }),
  });

  return (
    <section aria-labelledby="titulo-valor-estoque" className="space-y-4">
      <div>
        <h2 id="titulo-valor-estoque" className="text-lg font-semibold">
          Valor do estoque
        </h2>
        <p className="text-sm text-slate-600">
          Posição de agora, sem relação com o período acima.
        </p>
      </div>
      {query.isPending && <Spinner label="Carregando valor do estoque" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && query.data.categories.length === 0 && (
        <p className="text-sm text-slate-600">Nenhum produto com saldo.</p>
      )}
      {query.isSuccess && query.data.categories.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Valor do estoque por categoria
            </caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Categoria
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Produtos com saldo
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Unidades
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Valor a custo
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Valor de venda
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {query.data.categories.map((category) => (
                <tr
                  key={category.categoryId}
                  className="border-b border-slate-100"
                >
                  <th scope="row" className="px-3 py-2 font-normal">
                    {category.categoryName}
                  </th>
                  <td className="px-3 py-2 text-right">
                    {category.products}
                    {category.inactiveProducts > 0 && (
                      <span className="block text-xs text-slate-600">
                        {category.inactiveProducts}{' '}
                        {category.inactiveProducts === 1
                          ? 'desativado'
                          : 'desativados'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{category.units}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {formatMoney(category.costValue)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {formatMoney(category.saleValue)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 font-semibold tabular-nums">
              <tr>
                <th scope="row" className="px-3 py-2">
                  Total
                </th>
                <td className="px-3 py-2 text-right">
                  {query.data.categories.reduce(
                    (sum, c) => sum + c.products,
                    0,
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {query.data.totalUnits}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatMoney(query.data.totalCostValue)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatMoney(query.data.totalSaleValue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
