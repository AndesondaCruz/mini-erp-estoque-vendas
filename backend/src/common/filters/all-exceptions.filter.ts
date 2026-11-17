import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
  requestId?: string;
}

// Formato único de erro para toda a API. O front trata um só formato,
// e o requestId liga a resposta à linha correspondente no log.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const body = this.buildBody(exception, request);

    if (body.statusCode >= 500) {
      // Erro inesperado: registra a causa real no log, mas nunca a devolve ao cliente.
      this.logger.error(
        { err: exception, requestId: body.requestId },
        'Erro não tratado',
      );
    }

    response.status(body.statusCode).json(body);
  }

  private buildBody(
    exception: unknown,
    request: Request & { id?: string },
  ): ErrorResponseBody {
    const base = {
      // originalUrl é o caminho completo pedido pelo cliente (com /api/v1).
      // request.url pode vir relativo ao roteador em que a rota foi montada.
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    if (!(exception instanceof HttpException)) {
      return {
        ...base,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'Erro interno. Tente novamente mais tarde.',
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const error = HttpStatus[statusCode]
      ? this.toTitle(HttpStatus[statusCode])
      : 'Error';

    if (typeof payload === 'string') {
      return { ...base, statusCode, error, message: payload };
    }

    const { message, details } = payload as {
      message?: string | string[];
      details?: unknown;
    };

    // O ValidationPipe devolve um array de mensagens: vira "details".
    if (Array.isArray(message)) {
      return {
        ...base,
        statusCode,
        error,
        message: 'Dados inválidos',
        details: message,
      };
    }

    return {
      ...base,
      statusCode,
      error,
      message: message ?? exception.message,
      ...(details !== undefined && { details }),
    };
  }

  // NOT_FOUND -> Not Found
  private toTitle(constantName: string): string {
    return constantName
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
