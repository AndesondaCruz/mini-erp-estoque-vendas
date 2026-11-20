import { zodResolver } from '@hookform/resolvers/zod';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import { Pagination } from '../../components/Pagination';
import { SearchForm } from '../../components/SearchForm';
import { SortableHeader } from '../../components/SortableHeader';
import { Spinner } from '../../components/Spinner';
import {
  dangerLinkButton,
  fieldA11y,
  inputClass,
  linkButton,
  primaryButton,
  secondaryButton,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useListParams } from '../../lib/list-params';
import type { Category, Paginated } from '../../lib/types';
import { NAME_SORT_FIELDS } from '../../lib/types';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome')
    .max(80, 'Use até 80 caracteres'),
});
type CategoryForm = z.infer<typeof schema>;

/**
 * Categoria só tem nome e a API não tem GET /categories/:id, então tudo
 * acontece nesta página: criar no topo, renomear na própria linha.
 */
export function CategoriesPage() {
  const list = useListParams(NAME_SORT_FIELDS, 'name');
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const query = useQuery({
    queryKey: ['categories', list.page, list.search, list.sort, list.order],
    queryFn: ({ signal }) =>
      api<Paginated<Category>>('/categories', {
        signal,
        query: {
          page: list.page,
          search: list.search,
          sort: list.sort,
          order: list.order,
        },
      }),
    // Mantém a página anterior na tela enquanto a próxima carrega.
    placeholderData: keepPreviousData,
  });

  const done = async (message: string) => {
    setNotice(message);
    await queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  const remove = useMutation({
    mutationFn: (category: Category) =>
      api<void>(`/categories/${category.id}`, { method: 'DELETE' }),
    onSuccess: (_, category) => done(`Categoria "${category.name}" excluída.`),
  });

  return (
    <section aria-labelledby="titulo-categorias" className="space-y-6">
      <h1 id="titulo-categorias" className="text-2xl font-semibold">
        Categorias
      </h1>

      <NewCategoryForm
        onCreated={(c) => done(`Categoria "${c.name}" criada.`)}
      />

      <SearchForm
        key={list.search}
        label="Buscar por nome"
        value={list.search}
        onSearch={(search) => list.update({ search })}
      />

      {/* <output> é uma região viva (role status): o leitor de tela anuncia
          o resultado das ações sem tirar o foco de onde a pessoa está. */}
      <output className="block text-sm text-green-800">{notice}</output>
      {remove.isError && <ErrorMessage error={remove.error} />}

      {query.isPending && <Spinner label="Carregando categorias" />}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && (
        <>
          <table className="w-full border-collapse bg-white text-left text-sm">
            <caption className="sr-only">Categorias cadastradas</caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <SortableHeader
                  field="name"
                  label="Nome"
                  sort={list.sort}
                  order={list.order}
                  onSort={list.toggleSort}
                />
                <th scope="col" className="px-3 py-2 text-right">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center">
                    Nenhuma categoria encontrada.
                  </td>
                </tr>
              )}
              {query.data.data.map((category) =>
                editingId === category.id ? (
                  <tr key={category.id} className="border-b border-slate-100">
                    <td colSpan={2} className="px-3 py-2">
                      <RenameForm
                        category={category}
                        onCancel={() => setEditingId(null)}
                        onRenamed={(c) => {
                          setEditingId(null);
                          return done(`Categoria renomeada para "${c.name}".`);
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={category.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{category.name}</td>
                    <td className="space-x-4 px-3 py-2 text-right">
                      <button
                        type="button"
                        className={linkButton}
                        onClick={() => setEditingId(category.id)}
                        aria-label={`Renomear ${category.name}`}
                      >
                        Renomear
                      </button>
                      <button
                        type="button"
                        className={dangerLinkButton}
                        disabled={remove.isPending}
                        aria-label={`Excluir ${category.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Excluir a categoria "${category.name}"?`,
                            )
                          ) {
                            remove.mutate(category);
                          }
                        }}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <Pagination
            meta={query.data.meta}
            onPageChange={(page) => list.update({ page })}
          />
        </>
      )}
    </section>
  );
}

function NewCategoryForm({
  onCreated,
}: {
  onCreated: (category: Category) => Promise<void>;
}) {
  const form = useForm<CategoryForm>({ resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: (body: CategoryForm) =>
      api<Category>('/categories', { method: 'POST', body }),
    onSuccess: async (category) => {
      form.reset({ name: '' });
      await onCreated(category);
    },
  });
  const error = form.formState.errors.name;

  return (
    <form
      noValidate
      onSubmit={(e) => void form.handleSubmit((body) => create.mutate(body))(e)}
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-4"
      aria-labelledby="titulo-nova-categoria"
    >
      <h2 id="titulo-nova-categoria" className="font-medium">
        Nova categoria
      </h2>
      <div className="flex items-start gap-2">
        <div className="grow">
          <Field id="nova-categoria" label="Nome" error={error}>
            <input
              {...fieldA11y('nova-categoria', error)}
              className={inputClass}
              {...form.register('name')}
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={create.isPending}
          className={`${primaryButton} mt-6`}
        >
          Criar
        </button>
      </div>
      {create.isError && <ErrorMessage error={create.error} />}
    </form>
  );
}

function RenameForm({
  category,
  onCancel,
  onRenamed,
}: {
  category: Category;
  onCancel: () => void;
  onRenamed: (category: Category) => Promise<void>;
}) {
  const form = useForm<CategoryForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: category.name },
  });
  const rename = useMutation({
    mutationFn: (body: CategoryForm) =>
      api<Category>(`/categories/${category.id}`, { method: 'PATCH', body }),
    onSuccess: onRenamed,
  });
  const error = form.formState.errors.name;
  const id = `renomear-${category.id}`;
  const { setFocus } = form;

  // A pessoa clicou em "Renomear": o botão some e o foco iria para o <body>.
  // Levar o foco ao campo evita que quem usa teclado se perca.
  useEffect(() => setFocus('name'), [setFocus]);

  return (
    <form
      noValidate
      onSubmit={(e) => void form.handleSubmit((body) => rename.mutate(body))(e)}
      className="space-y-2"
    >
      <div className="flex items-start gap-2">
        <div className="grow">
          <Field
            id={id}
            label={`Novo nome para ${category.name}`}
            error={error}
          >
            <input
              {...fieldA11y(id, error)}
              className={inputClass}
              {...form.register('name')}
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={rename.isPending}
          className={`${primaryButton} mt-6`}
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`${secondaryButton} mt-6`}
        >
          Cancelar
        </button>
      </div>
      {rename.isError && <ErrorMessage error={rename.error} />}
    </form>
  );
}
