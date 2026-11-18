import { endOfDayExclusiveIso, startOfDayIso } from './dates';

describe('datas de filtro', () => {
  it('início do dia no fuso local', () => {
    expect(startOfDayIso('2026-11-01')).toBe(
      new Date(2026, 10, 1, 0, 0, 0).toISOString(),
    );
  });

  it('"até 30/11" vira 01/12 00:00, porque o to da API é exclusivo', () => {
    expect(endOfDayExclusiveIso('2026-11-30')).toBe(
      new Date(2026, 11, 1, 0, 0, 0).toISOString(),
    );
  });

  it('virada de ano', () => {
    expect(endOfDayExclusiveIso('2026-12-31')).toBe(
      new Date(2027, 0, 1, 0, 0, 0).toISOString(),
    );
  });
});
