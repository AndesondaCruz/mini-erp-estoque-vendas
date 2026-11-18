import { BadRequestException } from '@nestjs/common';
import { assertDateRange } from './date-range.js';

describe('assertDateRange', () => {
  it.each([
    ['um dia só', '2026-11-17', '2026-11-17'],
    ['um mês', '2026-11-01', '2026-11-30'],
    ['366 dias (limite)', '2028-01-01', '2028-12-31'],
  ])('aceita %s', (_, from, to) => {
    expect(() => assertDateRange(from, to)).not.toThrow();
  });

  it.each([
    ['data inexistente', '2026-02-30', '2026-03-01'],
    ['formato errado', '17/11/2026', '2026-11-30'],
    ['com horário', '2026-11-01T00:00:00Z', '2026-11-30'],
    ['from depois de to', '2026-11-30', '2026-11-01'],
    ['mais de 366 dias', '2026-01-01', '2027-01-02'],
  ])('recusa %s', (_, from, to) => {
    expect(() => assertDateRange(from, to)).toThrow(BadRequestException);
  });
});
