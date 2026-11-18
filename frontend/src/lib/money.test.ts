import { formatMoney, moneyField, toMoneyInput } from './money';

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

  it('prepara o valor da API para o campo do formulário', () => {
    expect(toMoneyInput('5.50')).toBe('5,50');
  });
});
