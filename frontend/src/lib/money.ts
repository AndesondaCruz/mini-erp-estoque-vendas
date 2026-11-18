import { z } from 'zod';

/**
 * Dinheiro trafega como string decimal ("12.50"), igual ao back-end.
 * O front só converte para number na hora de EXIBIR: nenhuma conta é feita
 * aqui, então o arredondamento de ponto flutuante nunca chega à API.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** "5.50" -> "R$ 5,50" */
export function formatMoney(value: string): string {
  return BRL.format(Number(value));
}

/** O mesmo padrão do back-end (DECIMAL(12,2)). */
export const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Campo de formulário: a pessoa digita "5,50" ou "5.50" e a API recebe
 * "5.50". Milhar com ponto ("1.234,56") também é aceito quando há vírgula.
 */
export const moneyField = z
  .string()
  .trim()
  .min(1, 'Informe o valor')
  .transform((value) =>
    value.includes(',') ? value.replaceAll('.', '').replace(',', '.') : value,
  )
  .refine((value) => MONEY_PATTERN.test(value), {
    message: 'Use um valor como 12,50 (até 2 casas decimais)',
  });

/** "5.50" -> "5,50", para preencher o formulário de edição. */
export function toMoneyInput(value: string): string {
  return value.replace('.', ',');
}
