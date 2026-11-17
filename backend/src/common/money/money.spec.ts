import { formatMoney, MONEY_PATTERN, toDecimal } from './money.js';

describe('money', () => {
  it.each(['0', '5', '5.5', '5.50', '9999999999.99'])('aceita "%s"', (v) => {
    expect(MONEY_PATTERN.test(v)).toBe(true);
  });

  it.each(['-1', '5.505', '5,50', '.50', '5.', '12345678901', ' 5', '1e3'])(
    'recusa "%s"',
    (v) => {
      expect(MONEY_PATTERN.test(v)).toBe(false);
    },
  );

  it('soma sem erro de ponto flutuante (0.1 + 0.2)', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // o problema que o Decimal evita
    expect(formatMoney(toDecimal('0.1').plus(toDecimal('0.2')))).toBe('0.30');
  });

  it('formata sempre com 2 casas', () => {
    expect(formatMoney(toDecimal('5.5'))).toBe('5.50');
    expect(formatMoney(toDecimal('7'))).toBe('7.00');
  });
});
