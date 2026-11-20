import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../../auth/auth-context';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import { fieldA11y, inputClass, primaryButton } from '../../components/ui';
import { api } from '../../lib/api';

// Mesma política do back-end (PASSWORD_MIN/MAX em change-password.dto.ts).
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN, `Use pelo menos ${PASSWORD_MIN} caracteres`)
      .max(PASSWORD_MAX, `Use até ${PASSWORD_MAX} caracteres`),
    confirmation: z.string(),
  })
  .refine((data) => data.confirmation === data.newPassword, {
    path: ['confirmation'],
    message: 'A confirmação não é igual à nova senha',
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ['newPassword'],
    message: 'A nova senha deve ser diferente da atual',
  });
type FormValues = z.infer<typeof schema>;

export const PASSWORD_CHANGED_NOTICE =
  'Senha alterada. Entre de novo com a nova senha.';

export function ChangePasswordPage() {
  const { endSession } = useAuth();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
  });
  const { errors } = form.formState;

  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: FormValues) =>
      api<void>('/auth/me/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
      }),
    onSuccess: () => {
      // A API já encerrou TODAS as sessões, inclusive esta, e apagou o
      // cookie. Chamar /auth/logout aqui usaria um token revogado (401,
      // tentativa de refresh, falha): só limpamos o lado do navegador.
      // Sem navigate: o RequireAuth vê a sessão encerrada e leva ao login,
      // onde o aviso aparece. Navegar daqui concorreria com ele.
      endSession(PASSWORD_CHANGED_NOTICE);
    },
  });

  return (
    <section aria-labelledby="titulo-senha" className="max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 id="titulo-senha" className="text-2xl font-semibold">
          Trocar minha senha
        </h1>
        <p className="text-sm text-slate-600">
          Ao trocar a senha, todas as suas sessões são encerradas, inclusive em
          outros aparelhos, e você entra de novo com a senha nova.
        </p>
      </div>
      <form
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit((values) => change.mutate(values))(e)
        }
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        <Field
          id="senha-atual"
          label="Senha atual"
          error={errors.currentPassword}
        >
          <input
            {...fieldA11y('senha-atual', errors.currentPassword)}
            type="password"
            autoComplete="current-password"
            className={inputClass}
            {...form.register('currentPassword')}
          />
        </Field>
        <Field
          id="senha-nova"
          label="Nova senha"
          error={errors.newPassword}
          hint={`Pelo menos ${PASSWORD_MIN} caracteres. Uma frase longa é mais segura que símbolos.`}
        >
          <input
            {...fieldA11y('senha-nova', errors.newPassword)}
            type="password"
            autoComplete="new-password"
            className={inputClass}
            {...form.register('newPassword')}
          />
        </Field>
        <Field
          id="senha-confirmacao"
          label="Confirme a nova senha"
          error={errors.confirmation}
        >
          <input
            {...fieldA11y('senha-confirmacao', errors.confirmation)}
            type="password"
            autoComplete="new-password"
            className={inputClass}
            {...form.register('confirmation')}
          />
        </Field>
        {change.isError && <ErrorMessage error={change.error} />}
        <button
          type="submit"
          disabled={change.isPending}
          aria-busy={change.isPending}
          className={primaryButton}
        >
          {change.isPending ? 'Salvando...' : 'Trocar senha'}
        </button>
      </form>
    </section>
  );
}
