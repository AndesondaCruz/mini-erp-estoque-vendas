import { Matches, type ValidationOptions } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Dinheiro trafega no JSON como string decimal ("12.50"), nunca como number:
 * em JavaScript, 0.1 + 0.2 === 0.30000000000000004. A string vai direto para o
 * Decimal do Prisma, sem passar por ponto flutuante.
 *
 * Até 10 dígitos inteiros e 2 casas, o que cabe em DECIMAL(12,2).
 */
export const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export function IsMoney(options?: ValidationOptions): PropertyDecorator {
  return Matches(MONEY_PATTERN, {
    message: ({ property }) =>
      `${property} deve ser um valor em texto, como "12.50" (até 2 casas decimais)`,
    ...options,
  });
}

export function toDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Decimal -> "12.50". Sempre com 2 casas, para o front não precisar formatar. */
export function formatMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
