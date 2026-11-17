import { type ValidationOptions, ValidateBy } from 'class-validator';

/**
 * CNPJ no formato alfanumérico da Receita Federal: 12 posições de 0-9 ou A-Z
 * (raiz + ordem) e 2 dígitos verificadores numéricos. Os CNPJs só com números
 * continuam válidos: são um caso particular do formato novo.
 *
 * Cálculo dos dígitos (módulo 11): cada caractere vale o código ASCII menos 48.
 * Dígitos mantêm o valor ('7' -> 7); letras vão de 'A' = 17 até 'Z' = 42.
 */

const FORMAT = /^[0-9A-Z]{12}[0-9]{2}$/;
const WEIGHTS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_DV2 = [6, ...WEIGHTS_DV1];

/** Remove máscara e espaços e passa para maiúsculas: "12.abc.345/01de-35" -> "12ABC34501DE35". */
export function normalizeCnpj(value: string): string {
  return value.replace(/[.\-/\s]/g, '').toUpperCase();
}

function checkDigit(base: string, weights: number[]): number {
  // Só recebe texto já validado por FORMAT (ASCII), então índice = caractere.
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += (base.charCodeAt(i) - 48) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Espera o CNPJ já normalizado. */
export function isValidCnpj(cnpj: string): boolean {
  if (!FORMAT.test(cnpj)) return false;
  // "00000000000000" passa no cálculo, mas não é um CNPJ real.
  if (/^(.)\1{13}$/.test(cnpj)) return false;

  const dv1 = checkDigit(cnpj.slice(0, 12), WEIGHTS_DV1);
  const dv2 = checkDigit(cnpj.slice(0, 12) + dv1, WEIGHTS_DV2);
  return cnpj.endsWith(`${dv1}${dv2}`);
}

/** Decorator do class-validator. Use junto com um @Transform que normalize. */
export function IsCnpj(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCnpj',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidCnpj(value),
        defaultMessage: () => 'document deve ser um CNPJ válido',
      },
    },
    options,
  );
}
