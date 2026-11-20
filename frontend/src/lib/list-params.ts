import { useSearchParams } from 'react-router';

export type SortOrder = 'asc' | 'desc';

export const STATUS_OPTIONS = [
  { value: 'ativos', label: 'Ativos' },
  { value: 'inativos', label: 'Inativos' },
  { value: 'todos', label: 'Todos' },
] as const;

/** ?status= da URL -> parâmetro active da API. Sem status: só os ativos. */
export function activeFromStatus(status: string | null): boolean | undefined {
  if (status === 'todos') return undefined;
  return status !== 'inativos';
}

/**
 * Página, busca, ordenação e filtros de uma listagem, guardados na URL.
 *
 * Por que na URL e não em useState: o F5 e o botão voltar mantêm a lista
 * como estava, e o endereço de uma busca filtrada pode ser compartilhado.
 *
 * A URL pode ser editada à mão, então tudo é validado ao ler: página
 * inválida vira 1 e ordenação fora da lista permitida vira o padrão (em vez
 * de virar um 400 da API na tela).
 */
export function useListParams<S extends string>(
  sortFields: readonly S[],
  defaultSort: S,
  /** Vendas abrem da mais recente: 'desc'. Cadastros abrem em A-Z: 'asc'. */
  defaultOrder: SortOrder = 'asc',
) {
  const [params, setParams] = useSearchParams();

  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawSort = params.get('sort');
  const sort = sortFields.find((field) => field === rawSort) ?? defaultSort;
  const rawOrder = params.get('order');
  const order: SortOrder =
    rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : defaultOrder;
  const search = params.get('search') ?? '';

  /**
   * Muda um ou mais parâmetros. Mudar busca, filtro ou ordenação volta para
   * a página 1: a página 5 de uma busca nova pode nem existir.
   */
  function update(changes: Record<string, string | number | null>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (!('page' in changes)) next.delete('page');
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    });
  }

  /**
   * Clicar na coluna já ordenada inverte a ordem; outra coluna começa na
   * ordem padrão da lista.
   */
  function toggleSort(field: S) {
    const flipped: SortOrder = order === 'asc' ? 'desc' : 'asc';
    update({ sort: field, order: field === sort ? flipped : defaultOrder });
  }

  return {
    page,
    sort,
    order,
    search,
    get: (key: string) => params.get(key),
    update,
    toggleSort,
  };
}
