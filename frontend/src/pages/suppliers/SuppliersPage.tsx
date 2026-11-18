import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Pagination } from '../../components/Pagination';
import { SearchForm } from '../../components/SearchForm';
import { SortableHeader } from '../../components/SortableHeader';
import { Spinner } from '../../components/Spinner';
import { StatusFilter } from '../../components/StatusFilter';
import {
  dangerLinkButton,
  linkButton,
  primaryButton,
} from '../../components/ui';
import { api } from '../../lib/api';
import { activeFromStatus, useListParams } from '../../lib/list-params';
import type { Paginated, Supplier } from '../../lib/types';
import { NAME_SORT_FIELDS } from '../../lib/types';

export function SuppliersPage() {
  const list = useListParams(NAME_SORT_FIELDS, 'name');
  const status = list.get('status');
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');

  const query = useQuery({
    queryKey: [
      'suppliers',
      'list',
      {
        page: list.page,
        search: list.search,
        sort: list.sort,
        order: list.order,
        status,
      },
    ],
    queryFn: () =>
      api<Paginated<Supplier>>('/suppliers', {
        query: {
          page: list.page,
          search: list.search,
          sort: list.sort,
          order: list.order,
          active: activeFromStatus(status),
        },
      }),
    placeholderData: keepPreviousData,
  });

  // DELETE desativa (não apaga); reativar é PATCH com active: true.
  const toggle = useMutation({
    mutationFn: async (supplier: Supplier) => {
      if (supplier.active) {
        await api<void>(`/suppliers/${supplier.id}`, { method: 'DELETE' });
      } else {
        await api<Supplier>(`/suppliers/${supplier.id}`, {
          method: 'PATCH',
          body: { active: true },
        });
      }
    },
    onSuccess: async (_, supplier) => {
      setNotice(
        `Fornecedor "${supplier.name}" ${supplier.active ? 'desativado' : 'reativado'}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  return (
    <section aria-labelledby="titulo-fornecedores" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="titulo-fornecedores" className="text-2xl font-semibold">
          Fornecedores
        </h1>
        <Link to="/fornecedores/novo" className={primaryButton}>
          Novo fornecedor
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <SearchForm
          key={list.search}
          label="Buscar por nome ou CNPJ"
          value={list.search}
          onSearch={(search) => list.update({ search })}
        />
        <StatusFilter
          value={status}
          onChange={(value) => list.update({ status: value })}
        />
      </div>

      <output className="block text-sm text-green-800">{notice}</output>
      {toggle.isError && <ErrorMessage error={toggle.error} />}

      {query.isPending && <Spinner label="Carregando fornecedores" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white text-left text-sm">
              <caption className="sr-only">Fornecedores cadastrados</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <SortableHeader
                    field="name"
                    label="Nome"
                    sort={list.sort}
                    order={list.order}
                    onSort={list.toggleSort}
                  />
                  <th scope="col" className="px-3 py-2">
                    CNPJ
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Contato
                  </th>
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
                      Nenhum fornecedor encontrado.
                    </td>
                  </tr>
                )}
                {query.data.data.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{supplier.name}</td>
                    <td className="px-3 py-2">{supplier.document ?? '-'}</td>
                    <td className="px-3 py-2">
                      {[supplier.phone, supplier.email]
                        .filter(Boolean)
                        .join(' / ') || '-'}
                    </td>
                    <td className="px-3 py-2">
                      {supplier.active ? 'Ativo' : 'Inativo'}
                    </td>
                    <td className="space-x-4 whitespace-nowrap px-3 py-2 text-right">
                      <Link
                        to={`/fornecedores/${supplier.id}/editar`}
                        className={linkButton}
                        aria-label={`Editar ${supplier.name}`}
                      >
                        Editar
                      </Link>
                      <button
                        type="button"
                        disabled={toggle.isPending}
                        className={
                          supplier.active ? dangerLinkButton : linkButton
                        }
                        aria-label={`${supplier.active ? 'Desativar' : 'Reativar'} ${supplier.name}`}
                        onClick={() => {
                          if (
                            !supplier.active ||
                            window.confirm(
                              `Desativar o fornecedor "${supplier.name}"? Ele deixa de aparecer no cadastro de produtos.`,
                            )
                          ) {
                            toggle.mutate(supplier);
                          }
                        }}
                      >
                        {supplier.active ? 'Desativar' : 'Reativar'}
                      </button>
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
