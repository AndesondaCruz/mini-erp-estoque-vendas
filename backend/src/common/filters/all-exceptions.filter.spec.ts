import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AllExceptionsFilter,
  type ErrorResponseBody,
} from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  function run(exception: unknown): {
    status: number;
    body: ErrorResponseBody;
  } {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        // Simula o Express: url relativo ao roteador, originalUrl completo.
        getRequest: () => ({
          url: '/teste',
          originalUrl: '/api/v1/teste',
          id: 'req-123',
        }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);

    return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  }

  beforeAll(() => {
    // Silencia o log de erro esperado no teste de 500.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('formata uma HttpException com o requestId e o path', () => {
    const { status, body } = run(
      new NotFoundException('Produto não encontrado'),
    );

    expect(status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Produto não encontrado',
      path: '/api/v1/teste',
      requestId: 'req-123',
    });
    expect(body.details).toBeUndefined();
  });

  it('transforma o array do ValidationPipe em details', () => {
    const { status, body } = run(
      new BadRequestException([
        'name should not be empty',
        'price must be positive',
      ]),
    );

    expect(status).toBe(400);
    expect(body.message).toBe('Dados inválidos');
    expect(body.details).toEqual([
      'name should not be empty',
      'price must be positive',
    ]);
  });

  it('preserva details enviados explicitamente', () => {
    const { body } = run(
      new ConflictException({
        message: 'Estoque insuficiente',
        details: { productId: 'p1', available: 0 },
      }),
    );

    expect(body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      message: 'Estoque insuficiente',
      details: { productId: 'p1', available: 0 },
    });
  });

  it('esconde a mensagem de erros inesperados', () => {
    const { status, body } = run(new Error('senha do banco: hunter2'));

    expect(status).toBe(500);
    expect(body.message).toBe('Erro interno. Tente novamente mais tarde.');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
