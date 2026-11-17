import { isValidCnpj, normalizeCnpj } from './cnpj.js';

describe('CNPJ', () => {
  describe('normalizeCnpj', () => {
    it('remove máscara e espaços e passa para maiúsculas', () => {
      expect(normalizeCnpj(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35');
    });
  });

  describe('isValidCnpj', () => {
    it('aceita CNPJ só com números', () => {
      expect(isValidCnpj('11222333000181')).toBe(true);
    });

    it('aceita CNPJ alfanumérico (exemplo da Receita Federal)', () => {
      expect(isValidCnpj('12ABC34501DE35')).toBe(true);
    });

    it.each([
      ['dígito verificador errado', '11222333000182'],
      ['dígito verificador alfanumérico trocado', '12ABC34501DE36'],
      ['todos os caracteres iguais', '00000000000000'],
      ['tamanho errado', '1122233300018'],
      ['letra nos dígitos verificadores', '12ABC34501DE3A'],
      ['minúsculas (não normalizado)', '12abc34501de35'],
      ['com máscara (não normalizado)', '11.222.333/0001-81'],
    ])('recusa: %s', (_, cnpj) => {
      expect(isValidCnpj(cnpj)).toBe(false);
    });
  });
});
