import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import type { TopProduct } from '../../lib/types';

const LIMIT = 10;

/**
 * Ranking como tabela com uma barra dentro da célula de quantidade. Cada
 * valor já está escrito na ponta da barra, então não há dica de hover: a
 * barra é só reforço visual (aria-hidden) e a tabela é o próprio dado.
 */
export function TopProductsSection({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ['reports', 'top-products', { from, to }],
    queryFn: ({ signal }) =>
      api<TopProduct[]>('/reports/top-products', {
        query: { from, to, limit: LIMIT },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
  const maxQuantity = Math.max(
    ...(query.data ?? []).map((product) => product.quantity),
    1,
  );

  return (
    <section aria-labelledby="titulo-mais-vendidos" className="space-y-4">
      <h2 id="titulo-mais-vendidos" className="text-lg font-semibold">
        Produtos mais vendidos
      </h2>
      {query.isPending && <Spinner label="Carregando produtos mais vendidos" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && query.data.length === 0 && (
        <p className="text-sm text-slate-600">
          Nenhum produto vendido no período.
        </p>
      )}
      {query.isSuccess && query.data.length > 0 && (
        <div
          aria-busy={query.isPlaceholderData}
          className={`overflow-x-auto rounded-lg border border-slate-200 bg-white transition-opacity ${
            query.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Os {LIMIT} produtos mais vendidos no período, por quantidade
            </caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Produto
                </th>
                <th scope="col" className="w-1/2 px-3 py-2">
                  Quantidade
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Faturamento
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((product) => (
                <tr key={product.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">
                    {product.name}
                    <span className="block font-mono text-xs text-slate-600">
                      {product.sku}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {/* O pr-14 reserva o espaço do número: a barra do
                        primeiro ocupa 100% da faixa e o número cabe logo
                        depois da ponta, sem ser cortado. */}
                    <div className="flex items-center gap-2 pr-14">
                      {/* Barra de 12px de altura, ponta arredondada e base
                          reta, proporcional ao maior do ranking. */}
                      <div
                        aria-hidden="true"
                        data-testid="barra"
                        className="h-3 shrink-0 rounded-r bg-indigo-700"
                        style={{
                          width: `${(product.quantity / maxQuantity) * 100}%`,
                        }}
                      />
                      <span className="font-medium tabular-nums">
                        {product.quantity}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatMoney(product.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
