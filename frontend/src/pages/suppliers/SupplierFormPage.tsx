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
import type { Supplier } from '../../lib/types';

/** Campo opcional: vazio vira null, que no PATCH apaga o valor gravado. */
const optional = (inner: z.ZodType<string, string>) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(inner.nullable());

// O dígito verificador do CNPJ é conferido no back-end; aqui só o formato,
// para dar retorno rápido. Aceita o CNPJ alfanumérico (a partir de 2026).
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome')
    .max(120, 'Use até 120 caracteres'),
  document: optional(
    z
      .string()
      .regex(
        /^[0-9A-Za-z./-]{14,18}$/,
        'CNPJ com 14 caracteres, com ou sem máscara',
      ),
  ),
  phone: optional(
    z.string().regex(/^[0-9()+\-\s]{8,20}$/, 'Telefone com 8 a 20 caracteres'),
  ),
  email: optional(z.email('Informe um e-mail válido').max(254)),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function SupplierFormPage() {
  const { id } = useParams();
  const supplier = useQuery({
    queryKey: ['suppliers', 'detail', id],
    queryFn: () => api<Supplier>(`/suppliers/${id}`),
    enabled: id !== undefined,
  });

  if (id === undefined) return <SupplierForm />;
  if (supplier.isPending) return <Spinner label="Carregando fornecedor" />;
  if (supplier.isError) return <ErrorMessage error={supplier.error} />;
  return <SupplierForm supplier={supplier.data} />;
}

function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = supplier !== undefined;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: supplier?.name ?? '',
      document: supplier?.document ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (body: FormOutput) =>
      editing
        ? api<Supplier>(`/suppliers/${supplier.id}`, { method: 'PATCH', body })
        : api<Supplier>('/suppliers', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      await navigate('/fornecedores');
    },
  });

  const title = editing ? `Editar ${supplier.name}` : 'Novo fornecedor';

  return (
    <section aria-labelledby="titulo-form" className="max-w-xl space-y-6">
      <h1 id="titulo-form" className="text-2xl font-semibold">
        {title}
      </h1>
      <form
        noValidate
        onSubmit={(e) => void form.handleSubmit((body) => save.mutate(body))(e)}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        <Field id="nome" label="Nome" error={errors.name}>
          <input
            {...fieldA11y('nome', errors.name)}
            className={inputClass}
            {...form.register('name')}
          />
        </Field>
        <Field
          id="cnpj"
          label="CNPJ (opcional)"
          error={errors.document}
          hint="Com ou sem máscara"
        >
          <input
            {...fieldA11y('cnpj', errors.document)}
            className={inputClass}
            {...form.register('document')}
          />
        </Field>
        <Field id="telefone" label="Telefone (opcional)" error={errors.phone}>
          <input
            {...fieldA11y('telefone', errors.phone)}
            type="tel"
            className={inputClass}
            {...form.register('phone')}
          />
        </Field>
        <Field id="email" label="E-mail (opcional)" error={errors.email}>
          <input
            {...fieldA11y('email', errors.email)}
            type="email"
            className={inputClass}
            {...form.register('email')}
          />
        </Field>
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
          <Link to="/fornecedores" className={secondaryButton}>
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
}
