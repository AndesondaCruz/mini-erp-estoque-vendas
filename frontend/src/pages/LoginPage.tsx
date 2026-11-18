import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../auth/auth-context';
import { ErrorMessage } from '../components/ErrorMessage';

const schema = z.object({
  email: z.email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe a senha'),
});
type LoginForm = z.infer<typeof schema>;

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [apiError, setApiError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(schema) });

  // Volta para a página que o usuário tentou abrir antes do login.
  const from =
    (location.state as { from?: { pathname: string } } | null)?.from
      ?.pathname ?? '/';
  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setApiError(null);
    try {
      await login(email, password);
      await navigate(from, { replace: true });
    } catch (error) {
      setApiError(error);
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Entrar no Mini-ERP</h1>
        <p className="mb-6 text-sm text-slate-600">
          Estoque e vendas do seu comércio.
        </p>
        <form
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="space-y-4"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'email-erro' : undefined}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              {...register('email')}
            />
            {errors.email && (
              <p id="email-erro" className="mt-1 text-sm text-red-700">
                {errors.email.message}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium"
            >
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'senha-erro' : undefined}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              {...register('password')}
            />
            {errors.password && (
              <p id="senha-erro" className="mt-1 text-sm text-red-700">
                {errors.password.message}
              </p>
            )}
          </div>
          {apiError !== null && <ErrorMessage error={apiError} />}
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="w-full rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
          >
            {isSubmitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
