import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Pagination } from '../../components/Pagination';
import { SearchForm } from '../../components/SearchForm';
import { SortableHeader } from '../../components/SortableHeader';
import { Spinner } from '../../components/Spinner';
import { StatusFilter } from '../../components/StatusFilter';
import {
  dangerLinkButton,
  inputClass,
  linkButton,
  primaryButton,
} from '../../components/ui';
import { api } from '../../lib/api';
import { activeFromStatus, useListParams } from '../../lib/list-params';
import type { Paginated, User } from '../../lib/types';
import { ROLE_LABELS, ROLES, USER_SORT_FIELDS } from '../../lib/types';

export function UsersPage() {
  const { user: me } = useAuth();
  const list = useListParams(USER_SORT_FIELDS, 'name');
  const status = list.get('status');
  // Papel inválido digitado na URL é ignorado (em vez de virar um 400).
  const role = ROLES.find((value) => value === list.get('papel'));
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');

  const params = {
    page: list.page,
    search: list.search,
    sort: list.sort,
    order: list.order,
    role,
    active: activeFromStatus(status),
  };
  const query = useQuery({
    queryKey: ['users', 'list', params],
    queryFn: ({ signal }) =>
      api<Paginated<User>>('/users', { query: params, signal }),
    placeholderData: keepPreviousData,
  });

  // Usuário não é apagado (vendas e auditoria apontam para ele): desativar
  // e reativar são PATCH com active. Desativar encerra as sessões na API.
  const toggle = useMutation({
    mutationFn: (user: User) =>
      api<User>(`/users/${user.id}`, {
        method: 'PATCH',
        body: { active: !user.active },
      }),
    onSuccess: async (_, user) => {
      setNotice(
        `Usuário "${user.name}" ${user.active ? 'desativado' : 'reativado'}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <section aria-labelledby="titulo-usuarios" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="titulo-usuarios" className="text-2xl font-semibold">
          Usuários
        </h1>
        <Link to="/usuarios/novo" className={primaryButton}>
          Novo usuário
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <SearchForm
          key={list.search}
          label="Buscar por nome ou e-mail"
          value={list.search}
          onSearch={(search) => list.update({ search })}
        />
        <div>
          <label
            htmlFor="filtro-papel"
            className="mb-1 block text-sm font-medium"
          >
            Papel
          </label>
          <select
            id="filtro-papel"
            value={role ?? ''}
            onChange={(e) => list.update({ papel: e.target.value })}
            className={inputClass}
          >
            <option value="">Todos</option>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <StatusFilter
          value={status}
          onChange={(value) => list.update({ status: value })}
        />
      </div>

      <output className="block text-sm text-green-800">{notice}</output>
      {toggle.isError && <ErrorMessage error={toggle.error} />}

      {query.isPending && <Spinner label="Carregando usuários" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white text-left text-sm">
              <caption className="sr-only">Usuários cadastrados</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {(
                    [
                      ['name', 'Nome'],
                      ['email', 'E-mail'],
                      ['role', 'Papel'],
                    ] as const
                  ).map(([field, label]) => (
                    <SortableHeader
                      key={field}
                      field={field}
                      label={label}
                      sort={list.sort}
                      order={list.order}
                      onSort={list.toggleSort}
                    />
                  ))}
                  <th scope="col" className="px-3 py-2">
                    Situação
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                )}
                {query.data.data.map((user) => {
                  const isMe = user.id === me?.id;
                  return (
                    <tr key={user.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        {user.name}
                        {isMe && (
                          <span className="ml-2 rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">
                            você
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{user.email}</td>
                      <td className="px-3 py-2">{ROLE_LABELS[user.role]}</td>
                      <td className="px-3 py-2">
                        {user.active ? 'Ativo' : 'Inativo'}
                      </td>
                      <td className="space-x-4 whitespace-nowrap px-3 py-2 text-right">
                        <Link
                          to={`/auditoria?usuario=${user.id}`}
                          className={linkButton}
                          aria-label={`Ver auditoria de ${user.name}`}
                        >
                          Auditoria
                        </Link>
                        <Link
                          to={`/usuarios/${user.id}/editar`}
                          className={linkButton}
                          aria-label={`Editar ${user.name}`}
                        >
                          Editar
                        </Link>
                        {/* A API recusa desativar a si mesmo; aqui o botão
                            nem aparece, em vez de um erro previsível. */}
                        {!isMe && (
                          <button
                            type="button"
                            disabled={toggle.isPending}
                            className={
                              user.active ? dangerLinkButton : linkButton
                            }
                            aria-label={`${user.active ? 'Desativar' : 'Reativar'} ${user.name}`}
                            onClick={() => {
                              if (
                                !user.active ||
                                window.confirm(
                                  `Desativar o usuário "${user.name}"? As sessões abertas são encerradas e não será mais possível entrar com essa conta.`,
                                )
                              ) {
                                toggle.mutate(user);
                              }
                            }}
                          >
                            {user.active ? 'Desativar' : 'Reativar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
