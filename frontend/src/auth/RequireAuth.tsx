import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '../components/Spinner';
import type { Role } from '../lib/types';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { useAuth } from './auth-context';

/**
 * Guarda de rota: sem sessão vai para o login (e volta depois); papel sem
 * permissão vê a página 403. É só experiência do usuário: quem protege os
 * dados de verdade é o RolesGuard do back-end.
 */
export function RequireAuth({ roles }: { roles?: readonly Role[] }) {
  const { status, user, notice } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Spinner label="Carregando sessão" />;
  if (!user) {
    // Sessão encerrada de propósito (há aviso, ex.: senha trocada): o novo
    // login começa do início, e não volta para a página em que a pessoa
    // estava (que seria a própria troca de senha).
    return (
      <Navigate
        to="/login"
        replace
        state={notice ? undefined : { from: location }}
      />
    );
  }
  if (roles && !roles.includes(user.role)) return <ForbiddenPage />;
  return <Outlet />;
}
