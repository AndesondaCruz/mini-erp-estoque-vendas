import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnChart, type ColumnDatum } from '../../components/ColumnChart';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/api';
import {
  formatDate,
  formatMonthYear,
  formatShortDate,
  formatShortMonth,
} from '../../lib/dates';
import { formatCents, formatMoney, toCents } from '../../lib/money';
import type { GroupBy, SalesReport } from '../../lib/types';

interface Props {
  from: string;
  to: string;
  groupBy: GroupBy;
}

const COMPACT_BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Rótulos curto (eixo) e completo (dica e tabela) de cada período. */
function periodLabels(period: string, groupBy: GroupBy) {
  if (groupBy === 'month') {
    return { short: formatShortMonth(period), long: formatMonthYear(period) };
  }
  if (groupBy === 'week') {
    return {
      short: formatShortDate(period),
      long: `Semana de ${formatDate(period)}`,
    };
  }
  return { short: formatShortDate(period), long: formatDate(period) };
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export function SalesReportSection({ from, to, groupBy }: Props) {
  const query = useQuery({
    queryKey: ['reports', 'sales', { from, to, groupBy }],
    queryFn: ({ signal }) =>
      api<SalesReport>('/reports/sales', {
        query: { from, to, groupBy },
        signal,
      }),
    // Ao trocar o filtro, o gráfico anterior fica na tela (esmaecido) até
    // os dados novos chegarem: sem tela piscando nem layout pulando.
    placeholderData: keepPreviousData,
  });

  return (
    <section aria-labelledby="titulo-vendas-periodo" className="space-y-4">
      <h2 id="titulo-vendas-periodo" className="text-lg font-semibold">
        Vendas no período
      </h2>
      {query.isPending && <Spinner label="Carregando vendas do período" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <div
          aria-busy={query.isPlaceholderData}
          className={`space-y-4 transition-opacity ${
            query.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          <dl className="grid gap-4 sm:grid-cols-3">
            <StatTile
              label="Vendas concluídas"
              value={String(query.data.totalSales)}
            />
            <StatTile
              label="Faturamento"
              value={formatMoney(query.data.totalRevenue)}
            />
            <StatTile
              label="Ticket médio"
              value={
                query.data.averageTicket
                  ? formatMoney(query.data.averageTicket)
                  : '-'
              }
            />
          </dl>
          <SalesChart report={query.data} />
        </div>
      )}
    </section>
  );
}

function SalesChart({ report }: { report: SalesReport }) {
  if (report.totalSales === 0) {
    return (
      <p className="text-sm text-slate-600">
        Nenhuma venda concluída no período.
      </p>
    );
  }

  const data: ColumnDatum[] = report.rows.map((row) => {
    const labels = periodLabels(row.period, report.groupBy);
    return {
      key: row.period,
      label: labels.short,
      longLabel: `${labels.long}, ${row.sales} ${row.sales === 1 ? 'venda' : 'vendas'}`,
      value: toCents(row.revenue),
    };
  });

  return (
    <figure className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="text-sm font-medium">
        Faturamento por{' '}
        {report.groupBy === 'day'
          ? 'dia'
          : report.groupBy === 'week'
            ? 'semana'
            : 'mês'}
      </figcaption>
      {report.groupBy !== 'day' && (
        // O período começa na segunda (ou no dia 1º) anterior ao "De", mas
        // só conta os dias dentro do filtro, como no back-end.
        <p className="text-xs text-slate-600">
          O primeiro e o último período podem estar incompletos: só contam os
          dias dentro do filtro.
        </p>
      )}
      {/* Uma coluna só não é um gráfico: os cartões e a tabela bastam. */}
      {data.length > 1 && (
        <ColumnChart
          label="Faturamento por período"
          data={data}
          formatValue={formatCents}
          formatTick={(cents) => COMPACT_BRL.format(cents / 100)}
        />
      )}
      <details open={data.length === 1}>
        <summary className="cursor-pointer text-sm font-medium text-indigo-700">
          Ver os dados em tabela ({data.length}{' '}
          {data.length === 1 ? 'período' : 'períodos'})
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Faturamento por período</caption>
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Período
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Vendas
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Faturamento
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.rows.map((row) => (
                <tr key={row.period} className="border-b border-slate-100">
                  <td className="px-3 py-1.5">
                    {periodLabels(row.period, report.groupBy).long}
                  </td>
                  <td className="px-3 py-1.5 text-right">{row.sales}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {formatMoney(row.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
