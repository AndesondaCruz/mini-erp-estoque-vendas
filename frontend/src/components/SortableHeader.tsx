import type { SortOrder } from '../lib/list-params';

interface Props<S extends string> {
  field: S;
  label: string;
  sort: S;
  order: SortOrder;
  onSort: (field: S) => void;
  className?: string;
}

/**
 * Cabeçalho de coluna ordenável. aria-sort diz ao leitor de tela qual coluna
 * ordena a tabela e em que sentido; o botão dentro do th é o que recebe foco.
 */
export function SortableHeader<S extends string>({
  field,
  label,
  sort,
  order,
  onSort,
  className = '',
}: Props<S>) {
  const active = field === sort;
  const ariaSort = active
    ? order === 'asc'
      ? 'ascending'
      : 'descending'
    : undefined;

  return (
    <th scope="col" aria-sort={ariaSort} className={`px-3 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="font-medium hover:underline"
      >
        {label}
        <span aria-hidden="true" className="ml-1 text-slate-500">
          {active ? (order === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}
