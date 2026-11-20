import {
  addDays,
  daysInclusive,
  endOfDayExclusiveIso,
  firstDayOfMonth,
  formatDate,
  formatMonthYear,
  formatShortDate,
  formatShortMonth,
  isValidDate,
  startOfDayIso,
  todayDate,
} from './dates';

describe('datas de calendário (relatórios)', () => {
  it('hoje usa o dia local, não o UTC', () => {
    // 23h30 do dia 20 no fuso local: em UTC pode já ser dia 21.
    expect(todayDate(new Date(2026, 10, 20, 23, 30))).toBe('2026-11-20');
    expect(todayDate(new Date(2026, 10, 20, 0, 5))).toBe('2026-11-20');
  });

  it('dia 1º do mês e soma de dias com virada de mês e de ano', () => {
    expect(firstDayOfMonth('2026-11-20')).toBe('2026-11-01');
    expect(addDays('2026-11-20', -29)).toBe('2026-10-22');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('conta os dias com as duas pontas', () => {
    expect(daysInclusive('2026-11-20', '2026-11-20')).toBe(1);
    expect(daysInclusive('2026-11-01', '2026-11-30')).toBe(30);
    expect(daysInclusive('2026-01-01', '2026-12-31')).toBe(365);
    expect(daysInclusive('2026-11-21', '2026-11-20')).toBe(0);
  });

  it.each(['2026-02-30', '2026-13-01', '20-11-2026', 'ontem', ''])(
    'recusa "%s"',
    (value) => expect(isValidDate(value)).toBe(false),
  );

  it('formata as datas do eixo e da dica', () => {
    expect(formatShortDate('2026-11-07')).toBe('07/11');
    expect(formatDate('2026-11-07')).toBe('07/11/2026');
    expect(formatShortMonth('2026-01-01')).toBe('jan/26');
    expect(formatMonthYear('2026-11-01')).toBe('novembro de 2026');
  });
});

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
