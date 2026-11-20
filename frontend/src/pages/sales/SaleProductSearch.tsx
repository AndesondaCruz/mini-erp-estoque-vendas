import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { inputClass, secondaryButton } from '../../components/ui';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import type { Paginated, Product } from '../../lib/types';

interface Props {
  /** Quantidade já no carrinho, por produto, para o texto do botão. */
  inCart: ReadonlyMap<string, number>;
  onAdd: (product: Product) => void;
}

/**
 * Busca de produto da venda. É um <form> próprio, IRMÃO do formulário do
 * carrinho (e não filho, como no estoque): o Enter busca sem tratamento
 * manual e nunca envia a venda.
 */
export function SaleProductSearch({ inCart, onAdd }: Props) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ['products', 'sale-search', search],
    queryFn: ({ signal }) =>
      api<Paginated<Product>>('/products', {
        signal,
        // Só ativos: produto inativo não pode ser vendido (a API dá 409).
        query: { search, active: true, pageSize: 10, sort: 'name' },
      }),
    enabled: search !== null,
  });

  return (
    <section
      aria-labelledby="titulo-busca"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="titulo-busca" className="font-medium">
        Adicionar produto
      </h2>
      <search>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(text.trim());
          }}
          className="flex items-end gap-2"
        >
          <div className="grow">
            <label htmlFor="busca-venda" className="mb-1 block text-sm">
              Buscar por nome ou SKU
            </label>
            <input
              id="busca-venda"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={inputClass}
            />
          </div>
          <button type="submit" className={secondaryButton}>
            Buscar
          </button>
        </form>
      </search>

      {results.isFetching && <p className="text-sm">Buscando...</p>}
      {results.isSuccess && results.data.data.length === 0 && (
        <p className="text-sm">Nenhum produto encontrado.</p>
      )}
      {results.isSuccess && results.data.data.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {results.data.data.map((product) => {
            const quantity = inCart.get(product.id) ?? 0;
            const soldOut = product.currentStock === 0;
            return (
              <li
                key={product.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-mono text-xs">{product.sku}</span>{' '}
                  {product.name}
                  <span className="block text-slate-600">
                    {formatMoney(product.salePrice)}, saldo{' '}
                    {product.currentStock}
                    {quantity > 0 && `, ${quantity} no carrinho`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={soldOut}
                  onClick={() => onAdd(product)}
                  aria-label={
                    soldOut
                      ? `${product.name} sem estoque`
                      : quantity > 0
                        ? `Adicionar mais um ${product.name}`
                        : `Adicionar ${product.name}`
                  }
                  className={secondaryButton}
                >
                  {soldOut ? 'Sem estoque' : quantity > 0 ? '+1' : 'Adicionar'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
