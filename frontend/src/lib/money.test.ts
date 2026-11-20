import {
  formatCents,
  formatMoney,
  moneyField,
  toCents,
  toMoneyInput,
} from './money';

describe('dinheiro', () => {
  it('formata a string decimal da API em reais', () => {
    // toMatch com \s: o Intl usa espaço não separável depois de "R$".
    expect(formatMoney('5.50')).toMatch(/^R\$\s5,50$/);
    expect(formatMoney('1234567.80')).toMatch(/^R\$\s1\.234\.567,80$/);
  });

  it.each([
    ['5,50', '5.50'],
    ['5.50', '5.50'],
    [' 12 ', '12'],
    ['1.234,56', '1234.56'],
    ['0,5', '0.5'],
  ])('aceita "%s" e envia "%s" para a API', (typed, sent) => {
    expect(moneyField.parse(typed)).toBe(sent);
  });

  it.each(['', 'abc', '5,555', '-3', '12345678901'])('recusa "%s"', (typed) => {
    expect(moneyField.safeParse(typed).success).toBe(false);
  });

  it.each([
    ['5.50', 550],
    ['5.5', 550],
    ['12', 1200],
    ['0.10', 10],
    ['0.01', 1],
  ])('converte "%s" em %i centavos', (value, cents) => {
    expect(toCents(value)).toBe(cents);
  });

  it('soma em centavos sem erro de ponto flutuante', () => {
    // Em float: 0.1 * 3 = 0.30000000000000004.
    expect(toCents('0.10') * 3).toBe(30);
    expect(formatCents(toCents('0.10') * 3)).toMatch(/^R\$\s0,30$/);
  });

  it('prepara o valor da API para o campo do formulário', () => {
    expect(toMoneyInput('5.50')).toBe('5,50');
  });
});
