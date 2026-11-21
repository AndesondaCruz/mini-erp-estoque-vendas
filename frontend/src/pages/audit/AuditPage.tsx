import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Pagination } from '../../components/Pagination';
import { SortableHeader } from '../../components/SortableHeader';
import { Spinner } from '../../components/Spinner';
import { inputClass, linkButton } from '../../components/ui';
import { api } from '../../lib/api';
import {
  DATE_PATTERN,
  endOfDayExclusiveIso,
  formatDateTime,
  startOfDayIso,
} from '../../lib/dates';
import { useListParams } from '../../lib/list-params';
import type {
  AuditAction,
  AuditEntity,
  AuditLog,
  Paginated,
  User,
} from '../../lib/types';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '../../lib/types';
import { AuditChanges } from './AuditChanges';

const ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AuditAction[];
const ENTITIES = Object.keys(AUDIT_ENTITY_LABELS) as AuditEntity[];
// A API só ordena a auditoria por data.
const SORT_FIELDS = ['createdAt'] as const;

/** Data da URL só se tiver o formato do <input type="date">. */
const validDate = (value: string | null) =>
  value !== null && DATE_PATTERN.test(value) ? value : '';

export function AuditPage() {
  const list = useListParams(SORT_FIELDS, 'createdAt', 'desc');
  // Ação e entidade fora da lista (URL editada à mão) são ignoradas.
  const action = ACTIONS.find((value) => value === list.get('acao'));
  const entity = ENTITIES.find((value) => value === list.get('entidade'));
  // O usuário vem do link "Auditoria" da tela de usuários ou de um clique no
  // nome aqui. Um id malformado é recusado pela API com 400, na tela.
  const userId = list.get('usuario') ?? undefined;
  const from = validDate(list.get('de'));
  const to = validDate(list.get('ate'));

  const params = {
    page: list.page,
    sort: list.sort,
    order: list.order,
    userId,
    action,
    entity,
    from: from ? startOfDayIso(from) : undefined,
    to: to ? endOfDayExclusiveIso(to) : undefined,
  };
  const query = useQuery({
    queryKey: ['audit-logs', 'list', params],
    queryFn: ({ signal }) =>
      api<Paginated<AuditLog>>('/audit-logs', { query: params, signal }),
    placeholderData: keepPreviousData,
  });

  // Nome para o chip do filtro. Busca o usuário em vez de procurar nas
  // linhas: a página atual pode não ter nenhum registro dele.
  const filteredUser = useQuery({
    queryKey: ['users', 'detail', userId],
    queryFn: ({ signal }) => api<User>(`/users/${userId}`, { signal }),
    enabled: userId !== undefined,
    retry: false,
  });

  return (
    <section aria-labelledby="titulo-auditoria" className="space-y-6">
      <div className="space-y-1">
        <h1 id="titulo-auditoria" className="text-2xl font-semibold">
          Auditoria
        </h1>
        <p className="text-sm text-slate-600">
          Registro das ações sensíveis. Não pode ser editado nem apagado, nem
          por um administrador.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label
            htmlFor="filtro-acao"
            className="mb-1 block text-sm font-medium"
          >
            Ação
          </label>
          <select
            id="filtro-acao"
            value={action ?? ''}
            onChange={(e) => list.update({ acao: e.target.value })}
            className={inputClass}
          >
            <option value="">Todas</option>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>
                {AUDIT_ACTION_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="filtro-entidade"
            className="mb-1 block text-sm font-medium"
          >
            Entidade
          </label>
          <select
            id="filtro-entidade"
            value={entity ?? ''}
            onChange={(e) => list.update({ entidade: e.target.value })}
            className={inputClass}
          >
            <option value="">Todas</option>
            {ENTITIES.map((value) => (
              <option key={value} value={value}>
                {AUDIT_ENTITY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filtro-de" className="mb-1 block text-sm font-medium">
            De
          </label>
          <input
            id="filtro-de"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => list.update({ de: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="filtro-ate"
            className="mb-1 block text-sm font-medium"
          >
            Até (inclusive)
          </label>
          <input
            id="filtro-ate"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => list.update({ ate: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      {userId !== undefined && (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-900">
            Usuário:{' '}
            <strong>
              {filteredUser.data
                ? `${filteredUser.data.name} (${filteredUser.data.email})`
                : userId}
            </strong>
          </span>
          <button
            type="button"
            className={linkButton}
            onClick={() => list.update({ usuario: null })}
          >
            Ver de todos os usuários
          </button>
        </p>
      )}

      {query.isPending && <Spinner label="Carregando auditoria" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white text-left text-sm">
              <caption className="sr-only">Registros de auditoria</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <SortableHeader
                    field="createdAt"
                    label="Data"
                    sort={list.sort}
                    order={list.order}
                    onSort={list.toggleSort}
                  />
                  <th scope="col" className="px-3 py-2">
                    Quem
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Ação
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Detalhes
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.data.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                )}
                {query.data.data.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-slate-100 align-top"
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(log.createdAt)}
                    </td>
                    {/* Largura mínima: sem ela, "Gustavo Gerente (demo)"
                        quebrava em três linhas ao lado dos detalhes. */}
                    <td className="min-w-44 px-3 py-2">
                      {log.user ? (
                        <button
                          type="button"
                          className={linkButton}
                          aria-label={`Filtrar pelos registros de ${log.user.name}`}
                          onClick={() =>
                            list.update({ usuario: log.user?.id ?? null })
                          }
                        >
                          {log.user.name}
                        </button>
                      ) : (
                        <span className="text-slate-600">
                          Ninguém (sem login)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                      {log.entity && (
                        <span className="block text-xs text-slate-600">
                          {AUDIT_ENTITY_LABELS[log.entity] ?? log.entity}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {/* <details> nativo: abre e fecha com teclado e leitor
                          de tela sem nenhum código a mais. */}
                      <details>
                        <summary className="cursor-pointer text-indigo-700">
                          Ver detalhes
                          <span className="sr-only">
                            {' '}
                            de {AUDIT_ACTION_LABELS[log.action] ??
                              log.action}{' '}
                            em {formatDateTime(log.createdAt)}
                          </span>
                        </summary>
                        <div className="mt-2">
                          <AuditChanges log={log} />
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            meta={query.data.meta}
            onPageChange={(page) => list.update({ page })}
          />
        </>
      )}
    </section>
  );
}
