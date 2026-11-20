import { createContext, useContext } from 'react';
import type { User } from '../lib/types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Aviso para a tela de login (ex.: "Senha alterada..."), ou null. */
  notice: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Limpa a sessão só no navegador, sem chamar a API. Para quando o servidor
   * já encerrou a sessão (ex.: depois de trocar a senha). `reason` aparece
   * na tela de login.
   */
  endSession: (reason?: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro do AuthProvider');
  return value;
}
