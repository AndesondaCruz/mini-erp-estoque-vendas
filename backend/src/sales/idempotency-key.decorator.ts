import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';

/**
 * Lê e valida o header Idempotency-Key (UUID gerado pelo cliente a cada
 * tentativa de venda). Ausente ou fora do formato: 400 com instrução clara.
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, context: ExecutionContext): string => {
    const value = context
      .switchToHttp()
      .getRequest<Request>()
      .header('idempotency-key');
    if (!value || !isUUID(value)) {
      throw new BadRequestException(
        'Header Idempotency-Key obrigatório: um UUID novo por tentativa de venda',
      );
    }
    return value.toLowerCase();
  },
);
