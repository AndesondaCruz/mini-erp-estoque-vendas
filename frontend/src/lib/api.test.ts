import { http, HttpResponse } from 'msw';
import { makeUser, mockState, server } from '../test/api-mock';
import {
  api,
  ApiError,
  refreshSession,
  setSessionExpiredHandler,
  tokenStore,
} from './api';

describe('cliente da API', () => {
  it('envia o access token no cabeçalho Authorization', async () => {
    const session = await (async () => {
      mockState.session = makeUser('GERENTE');
      return refreshSession();
    })();
    expect(session?.user.role).toBe('GERENTE');
    const res = await api<{ meta: { total: number } }>('/stock/alerts');
    // O mock calcula os alertas do catálogo de teste: 1 produto abaixo do mínimo.
    expect(res.meta.total).toBe(1);
  });

  it('3 chamadas com token expirado: UMA renovação e as 3 são repetidas', async () => {
    mockState.session = makeUser('GERENTE');
    tokenStore.set('token-expirado');

    const results = await Promise.all([
      api<{ meta: { total: number } }>('/stock/alerts'),
      api<{ meta: { total: number } }>('/stock/alerts'),
      api<{ meta: { total: number } }>('/stock/alerts'),
    ]);

    expect(mockState.refreshCalls).toBe(1);
    expect(results.map((r) => r.meta.total)).toEqual([1, 1, 1]);
    expect(tokenStore.get()).toBe(mockState.validToken);
  });

  it('renovação falhou: avisa que a sessão expirou e lança o 401', async () => {
    tokenStore.set('token-expirado'); // e não há sessão (cookie) válida
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    const error = await api('/stock/alerts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBeNull();
    setSessionExpiredHandler(null);
  });

  it('lê message, details e requestId do formato de erro da API', async () => {
    server.use(
      http.get('*/api/v1/products', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Estoque insuficiente',
            details: { available: 2 },
            requestId: 'abc-123',
          },
          { status: 409 },
        ),
      ),
    );
    const error = (await api('/products').catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({
      status: 409,
      message: 'Estoque insuficiente',
      details: { available: 2 },
      requestId: 'abc-123',
    });
  });

  it('monta a query string sem valores vazios', async () => {
    let received = '';
    server.use(
      http.get('*/api/v1/products', ({ request }) => {
        received = new URL(request.url).search;
        return HttpResponse.json({});
      }),
    );
    await api('/products', { query: { page: 2, search: '', active: true } });
    expect(received).toBe('?page=2&active=true');
  });
});
