import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { ErrorMessage } from '../components/ErrorMessage';
import { Spinner } from '../components/Spinner';
import { api } from '../lib/api';
import type { Paginated } from '../lib/types';
import { ROLE_LABELS } from '../lib/types';

export function HomePage() {
  const { user } = useAuth();
  const alerts = useQuery({
    queryKey: ['stock-alerts', 'count'],
    // pageSize=1: só interessa o total.
    queryFn: () =>
      api<Paginated<unknown>>('/stock/alerts', { query: { pageSize: 1 } }),
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
      <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-600">
          Produtos abaixo do estoque mínimo
        </h2>
        {alerts.isPending && <Spinner label="Carregando alertas" />}
        {alerts.isError && <ErrorMessage error={alerts.error} />}
        {alerts.isSuccess && (
          <p
            className="mt-2 text-3xl font-semibold"
            data-testid="alertas-total"
          >
            {alerts.data.meta.total}
          </p>
        )}
      </div>
    </section>
  );
}
