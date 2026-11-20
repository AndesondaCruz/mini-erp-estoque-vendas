import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  api,
  refreshSession,
  setSessionExpiredHandler,
  tokenStore,
} from '../lib/api';
import type { AuthResponse, User } from '../lib/types';
import { AuthContext, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // `reason` vira o aviso da tela de login. Ele mora aqui, e não no state da
  // navegação, porque quem leva ao login é o RequireAuth ao perceber a sessão
  // encerrada; uma navegação feita pela tela concorreria com ele.
  const endSession = useCallback(
    (reason?: string) => {
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
      setNotice(reason ?? null);
      queryClient.clear();
    },
    [queryClient],
  );

  // Ao abrir ou recarregar a página, o token em memória não existe mais:
  // a sessão volta pelo cookie de refresh, se ele ainda for válido.
  useEffect(() => {
    let active = true;
    void refreshSession().then((session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setStatus(session ? 'authenticated' : 'anonymous');
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(endSession);
    return () => setSessionExpiredHandler(null);
  }, [endSession]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    tokenStore.set(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
    setNotice(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      endSession();
    }
  }, [endSession]);

  const value = useMemo(
    () => ({ status, user, notice, login, logout, endSession }),
    [status, user, notice, login, logout, endSession],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}
