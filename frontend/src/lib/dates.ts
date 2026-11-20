/**
 * Datas de filtro. O <input type="date"> dá "2026-11-30", sem hora nem fuso;
 * a API quer um instante ISO 8601. A conversão usa o fuso do navegador, que
 * é o fuso de quem está olhando a tela.
 */

/** "2026-11-01" -> início do dia 1º no fuso local, em ISO (UTC). */
export function startOfDayIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

/**
 * "2026-11-30" -> início do dia SEGUINTE (01/12 00:00) no fuso local.
 * O `to` da API é exclusivo; mandar o próprio dia 30 às 00:00 deixaria o
 * dia 30 inteiro de fora do filtro "até 30/11".
 */
export function endOfDayExclusiveIso(date: string): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}

// ---------------------------------------------------------------------------
// Datas de calendário ("2026-11-20"), sem hora. Os relatórios da API recebem
// datas assim e aplicam o fuso da loja no servidor. Aqui nada passa por UTC:
// new Date("2026-11-20") seria meia-noite UTC, que no Brasil ainda é dia 19.

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Date local -> "2026-11-20". */
function toDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "2026-11-20" -> Date ao meio-dia local (longe da virada de dia e do horário de verão). */
function fromDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

/** Hoje, no fuso do navegador. */
export function todayDate(now = new Date()): string {
  return toDateOnly(now);
}

/** Dia 1º do mês de `date`. */
export function firstDayOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/** Soma (ou subtrai) dias de calendário. */
export function addDays(date: string, days: number): string {
  const result = fromDateOnly(date);
  result.setDate(result.getDate() + days);
  return toDateOnly(result);
}

/** Quantos dias o período tem, contando as duas pontas (20/11 a 20/11 = 1). */
export function daysInclusive(from: string, to: string): number {
  return (
    Math.round(
      (fromDateOnly(to).getTime() - fromDateOnly(from).getTime()) / DAY_MS,
    ) + 1
  );
}

/** Confere o formato e se o dia existe ("2026-02-30" não existe). */
export function isValidDate(value: string): boolean {
  return DATE_PATTERN.test(value) && toDateOnly(fromDateOnly(value)) === value;
}

const SHORT_DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
});
const MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
});
const MONTHS = 'jan fev mar abr mai jun jul ago set out nov dez'.split(' ');

/** "2026-11-17" -> "17/11" */
export function formatShortDate(date: string): string {
  return SHORT_DATE.format(fromDateOnly(date));
}

/** "2026-11-17" -> "17/11/2026", sem passar por fuso. */
export function formatDate(date: string): string {
  return date.split('-').reverse().join('/');
}

/** "2026-11-01" -> "novembro de 2026" */
export function formatMonthYear(date: string): string {
  return MONTH_YEAR.format(fromDateOnly(date));
}

/** "2026-11-01" -> "nov/26", curto para o eixo do gráfico. */
export function formatShortMonth(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]}/${date.slice(2, 4)}`;
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/** ISO -> "18/11/2026, 14:05" no fuso local. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
