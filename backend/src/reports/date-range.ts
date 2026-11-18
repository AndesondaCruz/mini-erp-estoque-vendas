import { BadRequestException } from '@nestjs/common';

export const MAX_RANGE_DAYS = 366;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Confere um período de relatório em datas de calendário (YYYY-MM-DD).
 * As duas pontas são inclusivas; o fuso é aplicado depois, no SQL.
 * "2026-02-30" é recusado: o Date do JavaScript aceitaria e viraria 2 de março.
 */
export function assertDateRange(from: string, to: string): void {
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (!DATE_ONLY.test(value) || !isRealDate(value)) {
      throw new BadRequestException(
        `${name} deve ser uma data válida no formato AAAA-MM-DD`,
      );
    }
  }
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (days < 0) {
    throw new BadRequestException('from não pode ser depois de to');
  }
  if (days + 1 > MAX_RANGE_DAYS) {
    throw new BadRequestException(
      `o período pode ter no máximo ${MAX_RANGE_DAYS} dias`,
    );
  }
}

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
