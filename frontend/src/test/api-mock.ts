import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { AuthResponse, Role, User } from '../lib/types';

/**
 * API falsa para os testes. `session` imita o cookie de refresh: quando há
 * um usuário nela, POST /auth/refresh devolve uma sessão nova.
 */
export const mockState: {
  session: User | null;
  validToken: string | null;
  refreshCalls: number;
  password: string;
} = {
  session: null,
  validToken: null,
  refreshCalls: 0,
  password: 'senha-certa',
};

export function makeUser(role: Role = 'VENDEDOR'): User {
  return {
    id: `${role.toLowerCase()}-1`,
    name: `Pessoa ${role}`,
    email: `${role.toLowerCase()}@loja.com`,
    role,
    active: true,
  };
}

let tokenCounter = 0;
function issue(user: User): AuthResponse {
  mockState.session = user;
  mockState.validToken = `token-${++tokenCounter}`;
  return {
    accessToken: mockState.validToken,
    tokenType: 'Bearer',
    expiresIn: 900,
    user,
  };
}

const apiError = (status: number, message: string) =>
  HttpResponse.json(
    { statusCode: status, message, requestId: 'req-teste-123' },
    { status },
  );

const authorized = (request: Request) =>
  mockState.validToken !== null &&
  request.headers.get('Authorization') === `Bearer ${mockState.validToken}`;

export const handlers = [
  http.post('*/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password !== mockState.password) {
      return apiError(401, 'E-mail ou senha inválidos');
    }
    const role = (body.email.split('@')[0].toUpperCase() as Role) ?? 'VENDEDOR';
    return HttpResponse.json(issue({ ...makeUser(role), email: body.email }));
  }),
  http.post('*/api/v1/auth/refresh', () => {
    mockState.refreshCalls++;
    if (!mockState.session) return apiError(401, 'Sessão expirada');
    return HttpResponse.json(issue(mockState.session));
  }),
  http.post('*/api/v1/auth/logout', () => {
    mockState.session = null;
    mockState.validToken = null;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/stock/alerts', ({ request }) => {
    if (!authorized(request)) return apiError(401, 'Token inválido');
    return HttpResponse.json({
      data: [],
      meta: { page: 1, pageSize: 1, total: 3, totalPages: 3 },
    });
  }),
];

export const server = setupServer(...handlers);

export function resetMockState(): void {
  mockState.session = null;
  mockState.validToken = null;
  mockState.refreshCalls = 0;
  mockState.password = 'senha-certa';
}
