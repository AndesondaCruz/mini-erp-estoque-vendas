import type { AuthResponse } from './types';

/**
 * Cliente HTTP da API.
 *
 * - O access token fica SÓ em memória (nunca em localStorage): um XSS não
 *   encontra token guardado. O refresh token está num cookie httpOnly que o
 *   JavaScript nem consegue ler.
 * - Chamadas com 401 renovam o token e são repetidas uma vez.
 * - A renovação é "single-flight": se várias chamadas recebem 401 juntas,
 *   uma única renovação acontece e as outras esperam por ela. Renovações em
 *   paralelo com o mesmo cookie seriam tratadas pelo back-end como reuso de
 *   token (409, ou revogação da sessão inteira).
 */

const API_PREFIX = '/api/v1';

let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (token: string) => {
    accessToken = token;
  },
  clear: () => {
    accessToken = null;
  },
};

/** O AuthProvider registra o que fazer quando a sessão não pode ser renovada. */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** Erro no formato padrão da API (filtro global do back-end). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type QueryValue = string | number | boolean | null | undefined;

function url(path: string, query?: Record<string, QueryValue>): string {
  // URL absoluta: funciona no navegador e nos testes (o fetch do Node não
  // resolve caminhos relativos).
  const result = new URL(API_PREFIX + path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      result.searchParams.set(key, String(value));
    }
  }
  return result.toString();
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    message?: unknown;
    details?: unknown;
    requestId?: string;
  } | null;
  const message =
    typeof body?.message === 'string'
      ? body.message
      : 'Não foi possível concluir a operação';
  return new ApiError(
    res.status,
    message,
    body?.details,
    body?.requestId ?? res.headers.get('x-request-id') ?? undefined,
  );
}

async function doRefresh(): Promise<AuthResponse | null> {
  const res = await fetch(url('/auth/refresh'), {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    tokenStore.clear();
    return null;
  }
  const session = (await res.json()) as AuthResponse;
  tokenStore.set(session.accessToken);
  return session;
}

/** Renova a sessão pelo cookie. Chamadas simultâneas compartilham a mesma promessa. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });

  // 401 fora das rotas de autenticação: token expirado. Renova e repete 1 vez.
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (session) return api<T>(path, options, true);
    onSessionExpired?.();
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
