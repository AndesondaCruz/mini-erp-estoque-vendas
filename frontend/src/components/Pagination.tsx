import type { Paginated } from '../lib/types';

interface Props {
  meta: Paginated<unknown>['meta'];
  onPageChange: (page: number) => void;
}

export function Pagination({ meta, onPageChange }: Props) {
  const { page, total, totalPages } = meta;
  const lastPage = Math.max(totalPages, 1);

  return (
    <nav
      aria-label="Paginação"
      className="flex items-center justify-between gap-4 py-3 text-sm"
    >
      <p className="text-slate-600">
        Página {page} de {lastPage} ({total}{' '}
        {total === 1 ? 'registro' : 'registros'})
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= lastPage}
          className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </nav>
  );
}
