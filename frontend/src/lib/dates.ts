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

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/** ISO -> "18/11/2026, 14:05" no fuso local. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
