import { useSearchParams } from 'react-router';
import { inputClass } from '../../components/ui';
import {
  addDays,
  daysInclusive,
  firstDayOfMonth,
  isValidDate,
  todayDate,
} from '../../lib/dates';
import type { GroupBy } from '../../lib/types';
import { MAX_REPORT_DAYS } from '../../lib/types';
import { SalesReportSection } from './SalesReportSection';
import { StockValueSection } from './StockValueSection';
import { TopProductsSection } from './TopProductsSection';

/** ?agrupar= da URL (em português) -> groupBy da API. */
const GROUPS: Record<string, { value: GroupBy; label: string }> = {
  dia: { value: 'day', label: 'Dia' },
  semana: { value: 'week', label: 'Semana (começa na segunda)' },
  mes: { value: 'month', label: 'Mês' },
};

/** Atalhos antes do intervalo personalizado: é o que mais se usa. */
function presets(today: string) {
  return [
    { label: 'Este mês', from: firstDayOfMonth(today), to: today },
    { label: 'Últimos 7 dias', from: addDays(today, -6), to: today },
    { label: 'Últimos 30 dias', from: addDays(today, -29), to: today },
    { label: 'Últimos 90 dias', from: addDays(today, -89), to: today },
  ];
}

/** Erro do período, com as mesmas regras do back-end (assertDateRange). */
function periodError(from: string, to: string): string | null {
  const days = daysInclusive(from, to);
  if (days < 1) return 'A data inicial não pode ser depois da final.';
  if (days > MAX_REPORT_DAYS) {
    return `O período pode ter no máximo ${MAX_REPORT_DAYS} dias.`;
  }
  return null;
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const today = todayDate();

  // Sem período na URL: este mês. A URL limpa continua significando "este
  // mês" amanhã ou no mês que vem, o que é o esperado de um favorito.
  const rawFrom = params.get('de') ?? '';
  const rawTo = params.get('ate') ?? '';
  const from = isValidDate(rawFrom) ? rawFrom : firstDayOfMonth(today);
  const to = isValidDate(rawTo) ? rawTo : today;
  const groupKey = params.get('agrupar') ?? '';
  const group = GROUPS[groupKey] ?? GROUPS.dia;
  const error = periodError(from, to);

  function update(changes: Record<string, string>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === '') next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  }

  const dateA11y = error
    ? ({ 'aria-invalid': true, 'aria-describedby': 'periodo-erro' } as const)
    : {};

  return (
    <section aria-labelledby="titulo-relatorios" className="space-y-8">
      <h1 id="titulo-relatorios" className="text-2xl font-semibold">
        Relatórios
      </h1>

      {/* Filtros numa linha, acima de tudo o que eles afetam. */}
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm font-medium">Período</legend>
          {presets(today).map((preset) => {
            const selected = preset.from === from && preset.to === to;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={selected}
                onClick={() => update({ de: preset.from, ate: preset.to })}
                className={`rounded-full border px-3 py-1 text-sm ${
                  selected
                    ? 'border-indigo-700 bg-indigo-50 font-medium text-indigo-900'
                    : 'border-slate-300 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="relatorio-de"
              className="mb-1 block text-sm font-medium"
            >
              De
            </label>
            <input
              id="relatorio-de"
              type="date"
              value={from}
              max={to}
              onChange={(e) => update({ de: e.target.value })}
              className={inputClass}
              {...dateA11y}
            />
          </div>
          <div>
            <label
              htmlFor="relatorio-ate"
              className="mb-1 block text-sm font-medium"
            >
              Até (inclusive)
            </label>
            <input
              id="relatorio-ate"
              type="date"
              value={to}
              min={from}
              onChange={(e) => update({ ate: e.target.value })}
              className={inputClass}
              {...dateA11y}
            />
          </div>
          <div>
            <label
              htmlFor="relatorio-agrupar"
              className="mb-1 block text-sm font-medium"
            >
              Agrupar vendas por
            </label>
            <select
              id="relatorio-agrupar"
              value={GROUPS[groupKey] ? groupKey : 'dia'}
              onChange={(e) => update({ agrupar: e.target.value })}
              className={inputClass}
            >
              {Object.entries(GROUPS).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p id="periodo-erro" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <p className="text-xs text-slate-600">
          Só vendas concluídas. As datas seguem o fuso da loja.
        </p>
      </div>

      {/* Período inválido: nem chama a API (que responderia 400). */}
      {!error && (
        <>
          <SalesReportSection from={from} to={to} groupBy={group.value} />
          <TopProductsSection from={from} to={to} />
        </>
      )}
      <StockValueSection />
    </section>
  );
}
