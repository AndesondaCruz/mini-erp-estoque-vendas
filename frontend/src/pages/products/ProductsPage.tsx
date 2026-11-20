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
import { formatMoney } from '../../lib/money';
import type { Paginated, Product } from '../../lib/types';
import { PRODUCT_SORT_FIELDS } from '../../lib/types';
import { useCategoryOptions } from './options';

export function ProductsPage() {
  const { user } = useAuth();
  // Esconder botões e colunas é só UX. Quem garante a regra é o back-end:
  // o VENDEDOR nem recebe costPrice, e as rotas de escrita respondem 403.
  const canManage = user?.role === 'ADMIN' || user?.role === 'GERENTE';
  const isAdmin = user?.role === 'ADMIN';

  const list = useListParams(PRODUCT_SORT_FIELDS, 'name');
  const categoryId = list.get('categoria');
  const lowStock = list.get('baixo') === '1';
  const status = list.get('status');
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const categories = useCategoryOptions();

  const filters = {
    page: list.page,
    search: list.search,
    sort: list.sort,
    order: list.order,
    categoryId,
    lowStock: lowStock || undefined,
    // Para o VENDEDOR a API já devolve só os ativos e ignora o parâmetro.
    active: canManage ? activeFromStatus(status) : undefined,
  };
  const query = useQuery({
    queryKey: ['products', 'list', filters],
    queryFn: ({ signal }) =>
      api<Paginated<Product>>('/products', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: async (product: Product) => {
      if (product.active) {
        await api<void>(`/products/${product.id}`, { method: 'DELETE' });
      } else {
        await api<Product>(`/products/${product.id}`, {
          method: 'PATCH',
          body: { active: true },
        });
      }
    },
    onSuccess: async (_, product) => {
      setNotice(
        `Produto "${product.name}" ${product.active ? 'desativado' : 'reativado'}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const columns = 5 + (canManage ? 3 : 0);

  return (
    <section aria-labelledby="titulo-produtos" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="titulo-produtos" className="text-2xl font-semibold">
          Produtos
        </h1>
        {canManage && (
          <Link to="/produtos/novo" className={primaryButton}>
            Novo produto
          </Link>
        )}
      </div>

      <div className="grid items-end gap-4 md:grid-cols-[2fr_1fr_auto_auto]">
        <SearchForm
          key={list.search}
          label="Buscar por nome ou SKU"
          value={list.search}
          onSearch={(search) => list.update({ search })}
        />
        <div>
          <label
            htmlFor="filtro-categoria"
            className="mb-1 block text-sm font-medium"
          >
            Categoria
          </label>
          <select
            id="filtro-categoria"
            value={categoryId ?? ''}
            onChange={(e) => list.update({ categoria: e.target.value })}
            className={inputClass}
          >
            <option value="">Todas</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        {canManage && (
          <StatusFilter
            value={status}
            onChange={(value) => list.update({ status: value })}
          />
        )}
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(e) =>
              list.update({ baixo: e.target.checked ? 1 : null })
            }
          />
          Só estoque baixo
        </label>
      </div>

      <output className="block text-sm text-green-800">{notice}</output>
      {toggle.isError && <ErrorMessage error={toggle.error} />}

      {query.isPending && <Spinner label="Carregando produtos" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white text-left text-sm">
              <caption className="sr-only">Produtos cadastrados</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <SortableHeader
                    field="sku"
                    label="SKU"
                    sort={list.sort}
                    order={list.order}
                    onSort={list.toggleSort}
                  />
                  <SortableHeader
                    field="name"
                    label="Nome"
                    sort={list.sort}
                    order={list.order}
                    onSort={list.toggleSort}
                  />
                  <th scope="col" className="px-3 py-2">
                    Categoria
                  </th>
                  {canManage && (
                    <th scope="col" className="px-3 py-2 text-right">
                      Custo
                    </th>
                  )}
                  <SortableHeader
                    field="salePrice"
                    label="Preço"
                    sort={list.sort}
                    order={list.order}
                    onSort={list.toggleSort}
                    className="text-right"
                  />
                  <SortableHeader
                    field="currentStock"
                    label="Estoque"
                    sort={list.sort}
                    order={list.order}
                    onSort={list.toggleSort}
                    className="text-right"
                  />
                  {canManage && (
                    <th scope="col" className="px-3 py-2">
                      Situação
                    </th>
                  )}
                  {canManage && (
                    <th scope="col" className="px-3 py-2 text-right">
                      Ações
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {query.data.data.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="px-3 py-6 text-center">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
                {query.data.data.map((product) => (
                  <tr key={product.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      {product.sku}
                    </td>
                    <td className="px-3 py-2">{product.name}</td>
                    <td className="px-3 py-2">{product.category.name}</td>
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        {product.costPrice
                          ? formatMoney(product.costPrice)
                          : '-'}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      {formatMoney(product.salePrice)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {product.currentStock}
                      {product.lowStock && (
                        // Texto, não só cor: quem não distingue o vermelho
                        // também recebe o aviso.
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                          baixo (mín. {product.minStock})
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2">
                        {product.active ? 'Ativo' : 'Inativo'}
                      </td>
                    )}
                    {canManage && (
                      <td className="space-x-4 whitespace-nowrap px-3 py-2 text-right">
                        <Link
                          to={`/produtos/${product.id}/editar`}
                          className={linkButton}
                          aria-label={`Editar ${product.name}`}
                        >
                          Editar
                        </Link>
                        <Link
                          to={`/estoque?produto=${product.id}`}
                          className={linkButton}
                          aria-label={`Movimentações de ${product.name}`}
                        >
                          Movimentações
                        </Link>
                        <Link
                          to={`/estoque/nova?produto=${product.id}`}
                          className={linkButton}
                          aria-label={`Lançar movimentação de ${product.name}`}
                        >
                          Lançar
                        </Link>
                        {isAdmin && (
                          <button
                            type="button"
                            disabled={toggle.isPending}
                            className={
                              product.active ? dangerLinkButton : linkButton
                            }
                            aria-label={`${product.active ? 'Desativar' : 'Reativar'} ${product.name}`}
                            onClick={() => {
                              if (
                                !product.active ||
                                window.confirm(
                                  `Desativar o produto "${product.name}"? Ele deixa de aparecer para venda.`,
                                )
                              ) {
                                toggle.mutate(product);
                              }
                            }}
                          >
                            {product.active ? 'Desativar' : 'Reativar'}
                          </button>
                        )}
                      </td>
                    )}
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
