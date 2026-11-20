import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import { Spinner } from '../../components/Spinner';
import {
  fieldA11y,
  inputClass,
  primaryButton,
  secondaryButton,
} from '../../components/ui';
import { api } from '../../lib/api';
import { moneyField, toMoneyInput } from '../../lib/money';
import type { Product } from '../../lib/types';
import { useCategoryOptions, useSupplierOptions } from './options';

const MAX_STOCK = 1_000_000;

// Espelha o CreateProductDto. O back-end valida de novo: isto é só para dar
// retorno antes de ir à rede.
const schema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9.-]{0,39}$/,
      'Até 40 caracteres entre letras, números, hífen e ponto',
    ),
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome')
    .max(160, 'Use até 160 caracteres'),
  categoryId: z.string().min(1, 'Escolha a categoria'),
  // "" no select = sem fornecedor = null na API.
  supplierId: z.string().transform((value) => (value === '' ? null : value)),
  costPrice: moneyField,
  salePrice: moneyField,
  minStock: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Use um número inteiro, 0 ou mais')
    .transform(Number)
    .pipe(z.number().max(MAX_STOCK, `No máximo ${MAX_STOCK}`)),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function ProductFormPage() {
  const { id } = useParams();
  const product = useQuery({
    queryKey: ['products', 'detail', id],
    queryFn: ({ signal }) => api<Product>(`/products/${id}`, { signal }),
    enabled: id !== undefined,
  });

  if (id === undefined) return <ProductForm />;
  if (product.isPending) return <Spinner label="Carregando produto" />;
  if (product.isError) return <ErrorMessage error={product.error} />;
  return <ProductForm product={product.data} />;
}

function ProductForm({ product }: { product?: Product }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategoryOptions();
  const suppliers = useSupplierOptions();
  const editing = product !== undefined;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      sku: product?.sku ?? '',
      name: product?.name ?? '',
      categoryId: product?.category.id ?? '',
      supplierId: product?.supplier?.id ?? '',
      costPrice: product?.costPrice ? toMoneyInput(product.costPrice) : '',
      salePrice: product ? toMoneyInput(product.salePrice) : '',
      minStock: String(product?.minStock ?? 0),
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (body: FormOutput) =>
      editing
        ? api<Product>(`/products/${product.id}`, { method: 'PATCH', body })
        : api<Product>('/products', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await navigate('/produtos');
    },
  });

  // Um fornecedor desativado depois do cadastro não vem na lista de ativos,
  // mas continua sendo o do produto: entra como opção para o select mostrá-lo.
  const supplierOptions = [...(suppliers.data ?? [])];
  if (
    product?.supplier &&
    !supplierOptions.some((s) => s.id === product.supplier?.id)
  ) {
    supplierOptions.push({
      ...product.supplier,
      name: `${product.supplier.name} (inativo)`,
      document: null,
      phone: null,
      email: null,
      active: false,
    });
  }

  if (categories.isPending || suppliers.isPending) {
    return <Spinner label="Carregando categorias e fornecedores" />;
  }
  if (categories.isError) return <ErrorMessage error={categories.error} />;
  if (suppliers.isError) return <ErrorMessage error={suppliers.error} />;

  const title = editing ? `Editar ${product.name}` : 'Novo produto';

  return (
    <section aria-labelledby="titulo-form" className="max-w-2xl space-y-6">
      <h1 id="titulo-form" className="text-2xl font-semibold">
        {title}
      </h1>
      {!editing && (
        <p className="text-sm text-slate-600">
          O produto começa com estoque 0. O saldo muda pelas movimentações de
          estoque.
        </p>
      )}
      <form
        noValidate
        onSubmit={(e) => void form.handleSubmit((body) => save.mutate(body))(e)}
        className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-2"
      >
        <Field id="sku" label="SKU" error={errors.sku} hint="Ex.: CER-350">
          <input
            {...fieldA11y('sku', errors.sku)}
            className={`${inputClass} uppercase`}
            {...form.register('sku')}
          />
        </Field>
        <Field id="nome" label="Nome" error={errors.name}>
          <input
            {...fieldA11y('nome', errors.name)}
            className={inputClass}
            {...form.register('name')}
          />
        </Field>
        <Field id="categoria" label="Categoria" error={errors.categoryId}>
          <select
            {...fieldA11y('categoria', errors.categoryId)}
            className={inputClass}
            {...form.register('categoryId')}
          >
            <option value="">Escolha</option>
            {categories.data.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="fornecedor"
          label="Fornecedor (opcional)"
          error={errors.supplierId}
        >
          <select
            {...fieldA11y('fornecedor', errors.supplierId)}
            className={inputClass}
            {...form.register('supplierId')}
          >
            <option value="">Sem fornecedor</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="custo" label="Preço de custo (R$)" error={errors.costPrice}>
          <input
            {...fieldA11y('custo', errors.costPrice)}
            inputMode="decimal"
            className={inputClass}
            {...form.register('costPrice')}
          />
        </Field>
        <Field id="preco" label="Preço de venda (R$)" error={errors.salePrice}>
          <input
            {...fieldA11y('preco', errors.salePrice)}
            inputMode="decimal"
            className={inputClass}
            {...form.register('salePrice')}
          />
        </Field>
        <Field
          id="minimo"
          label="Estoque mínimo"
          error={errors.minStock}
          hint="Abaixo ou igual a isto, o produto entra nos alertas"
        >
          <input
            {...fieldA11y('minimo', errors.minStock)}
            inputMode="numeric"
            className={inputClass}
            {...form.register('minStock')}
          />
        </Field>
        <div className="space-y-4 sm:col-span-2">
          {save.isError && <ErrorMessage error={save.error} />}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              aria-busy={save.isPending}
              className={primaryButton}
            >
              {save.isPending ? 'Salvando...' : 'Salvar'}
            </button>
            <Link to="/produtos" className={secondaryButton}>
              Cancelar
            </Link>
          </div>
        </div>
      </form>
    </section>
  );
}
