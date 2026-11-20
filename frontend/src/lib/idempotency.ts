/**
 * Idempotency-Key de uma tentativa de venda.
 *
 * A chave nasce no cliente porque só ele sabe que "esta requisição é a
 * repetição daquela": a resposta da primeira se perdeu (rede caiu, aba
 * travou) e a pessoa clicou de novo. Com a mesma chave, a API devolve a
 * venda já criada em vez de baixar o estoque duas vezes.
 *
 * crypto.randomUUID só existe em contexto seguro (HTTPS ou localhost). Um
 * fallback com Math.random não serve: a chave precisa ser imprevisível e
 * única entre todos os vendedores, então o erro é explícito.
 */
export class InsecureContextError extends Error {
  constructor() {
    super(
      'Este navegador não gera a chave da venda fora de HTTPS. Abra o sistema pelo endereço seguro (https://) ou por localhost.',
    );
    this.name = 'InsecureContextError';
  }
}

export function newIdempotencyKey(): string {
  if (typeof crypto === 'undefined' || !('randomUUID' in crypto)) {
    throw new InsecureContextError();
  }
  return crypto.randomUUID();
}
