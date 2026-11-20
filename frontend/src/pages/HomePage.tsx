import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { ErrorMessage } from '../components/ErrorMessage';
import { Spinner } from '../components/Spinner';
import { linkButton } from '../components/ui';
import { api } from '../lib/api';
import type { Paginated, StockAlert } from '../lib/types';
import { ROLE_LABELS } from '../lib/types';

const TOP = 5;

export function HomePage() {
  const { user } = useAuth();
  // O endpoint de alertas não traz custo: todos os papéis veem.
  const alerts = useQuery({
    queryKey: ['stock-alerts', 'top', TOP],
    // A API já ordena pela maior falta: a primeira página é o "top".
    queryFn: ({ signal }) =>
      api<Paginated<StockAlert>>('/stock/alerts', {
        signal,
        query: { pageSize: TOP },
      }),
  });

  return (
    <section aria-labelledby="titulo-inicio" className="space-y-6">
      <div>
        <h1 id="titulo-inicio" className="text-2xl font-semibold">
          Olá, {user?.name}
        </h1>
        <p className="text-slate-600">
          Você entrou como {user && ROLE_LABELS[user.role]}.
        </p>
      </div>
      <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-600">
          Produtos abaixo do estoque mínimo
        </h2>
        {alerts.isPending && <Spinner label="Carregando alertas" />}
        {alerts.isError && <ErrorMessage error={alerts.error} />}
        {alerts.isSuccess && (
          <>
            <p
              className="mt-2 text-3xl font-semibold"
              data-testid="alertas-total"
            >
              {alerts.data.meta.total}
            </p>
            {alerts.data.data.length > 0 && (
              <table className="mt-3 w-full text-left text-sm">
                <caption className="sr-only">
                  Produtos com maior falta de estoque
                </caption>
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th scope="col" className="py-1 pr-2">
                      Produto
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right">
                      Saldo / mínimo
                    </th>
                    <th scope="col" className="py-1 text-right">
                      Falta
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.data.data.map((alert) => (
                    <tr key={alert.id} className="border-b border-slate-100">
                      <td className="py-1 pr-2">
                        {alert.name}
                        <span className="block font-mono text-xs text-slate-600">
                          {alert.sku}
                        </span>
                      </td>
                      <td className="py-1 pr-2 text-right">
                        {alert.currentStock} / {alert.minStock}
                      </td>
                      <td className="py-1 text-right font-medium">
                        {alert.shortage}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {alerts.data.meta.total > 0 && (
              <Link
                to="/produtos?baixo=1"
                className={`${linkButton} mt-3 inline-block`}
              >
                Ver todos os produtos com estoque baixo
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  );
}
