import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../../auth/auth-context';
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
import type { Role, User } from '../../lib/types';
import { ROLE_LABELS, ROLES } from '../../lib/types';

// Limites do CreateUserDto do back-end.
const PASSWORD_MIN = 8;

/**
 * Um schema só, com a senha conferida apenas na criação: a edição não tem
 * senha (cada pessoa troca a própria em "Trocar senha"). Dois schemas de
 * formatos diferentes não cabem no mesmo useForm tipado.
 */
const schemaFor = (creating: boolean) =>
  z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Informe o nome')
        .max(120, 'Use até 120 caracteres'),
      email: z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.email('Informe um e-mail válido').max(254)),
      // Opcional porque fica desabilitado na própria conta, e campo
      // desabilitado não é enviado pelo react-hook-form.
      role: z.enum(ROLES as [Role, ...Role[]]).optional(),
      password: z.string().max(128, 'Use até 128 caracteres'),
    })
    .superRefine((values, ctx) => {
      if (creating && values.password.length < PASSWORD_MIN) {
        ctx.addIssue({
          code: 'custom',
          path: ['password'],
          message: `Use pelo menos ${PASSWORD_MIN} caracteres`,
        });
      }
    })
    // Na edição a senha nem vai para a API (o PATCH a recusaria).
    .transform(({ password, ...rest }) =>
      creating ? { ...rest, password } : rest,
    );
type FormInput = z.input<ReturnType<typeof schemaFor>>;
type FormOutput = z.output<ReturnType<typeof schemaFor>>;

export function UserFormPage() {
  const { id } = useParams();
  const user = useQuery({
    queryKey: ['users', 'detail', id],
    queryFn: ({ signal }) => api<User>(`/users/${id}`, { signal }),
    enabled: id !== undefined,
  });

  if (id === undefined) return <UserForm />;
  if (user.isPending) return <Spinner label="Carregando usuário" />;
  if (user.isError) return <ErrorMessage error={user.error} />;
  return <UserForm user={user.data} />;
}

function UserForm({ user }: { user?: User }) {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = user !== undefined;
  const isMe = editing && user.id === me?.id;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schemaFor(!editing)),
    defaultValues: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: user?.role ?? 'VENDEDOR',
      password: '',
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (body: FormOutput) =>
      editing
        ? api<User>(`/users/${user.id}`, { method: 'PATCH', body })
        : api<User>('/users', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await navigate('/usuarios');
    },
  });

  const title = editing ? `Editar ${user.name}` : 'Novo usuário';

  return (
    <section aria-labelledby="titulo-form" className="max-w-xl space-y-6">
      <h1 id="titulo-form" className="text-2xl font-semibold">
        {title}
      </h1>
      <form
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit((values) => save.mutate(values))(e)
        }
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        <Field id="nome" label="Nome" error={errors.name}>
          <input
            {...fieldA11y('nome', errors.name)}
            autoComplete="off"
            className={inputClass}
            {...form.register('name')}
          />
        </Field>
        <Field id="email" label="E-mail" error={errors.email}>
          <input
            {...fieldA11y('email', errors.email)}
            type="email"
            autoComplete="off"
            className={inputClass}
            {...form.register('email')}
          />
        </Field>
        {!editing && (
          <Field
            id="senha"
            label="Senha inicial"
            error={errors.password}
            hint={`Pelo menos ${PASSWORD_MIN} caracteres. Passe para a pessoa por um canal seguro; ela pode trocar depois em "Trocar senha".`}
          >
            <input
              {...fieldA11y('senha', errors.password)}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              {...form.register('password')}
            />
          </Field>
        )}
        <Field
          id="papel"
          label="Papel"
          error={errors.role}
          hint={
            isMe
              ? 'Você não pode alterar o próprio papel. Outro ADMIN pode.'
              : undefined
          }
        >
          <select
            {...fieldA11y('papel', errors.role)}
            className={inputClass}
            {...form.register('role', { disabled: isMe })}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
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
          <Link to="/usuarios" className={secondaryButton}>
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
}
