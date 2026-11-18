import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { inputClass, secondaryButton } from '../../components/ui';
import { api } from '../../lib/api';
import type { Paginated, Product } from '../../lib/types';

interface Props {
  selectedId: string | null;
  onSelect: (product: Product) => void;
  error?: { message?: string };
}

/**
 * Busca de produto com resultados em botões de rádio. Rádio já é acessível
 * (setas, Espaço, leitor de tela anuncia "1 de 5"), sem o código de um
 * combobox ARIA próprio.
 *
 * Não é um <form>: fica dentro do formulário da movimentação, e formulário
 * dentro de formulário é HTML inválido. O Enter é tratado à mão.
 */
export function ProductPicker({ selectedId, onSelect, error }: Props) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ['products', 'picker', search],
    queryFn: () =>
      api<Paginated<Product>>('/products', {
        query: { search, pageSize: 10, sort: 'name' },
      }),
    enabled: search !== null,
  });

  const run = () => setSearch(text.trim());

  return (
    <fieldset
      aria-describedby={error ? 'produto-erro' : undefined}
      className="space-y-3 rounded-md border border-slate-200 p-4"
    >
      <legend className="px-1 text-sm font-medium">Produto</legend>
      <div className="flex items-end gap-2">
        <div className="grow">
          <label htmlFor="busca-produto" className="mb-1 block text-sm">
            Buscar por nome ou SKU
          </label>
          <input
            id="busca-produto"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // não envia a movimentação
                run();
              }
            }}
            className={inputClass}
          />
        </div>
        <button type="button" onClick={run} className={secondaryButton}>
          Buscar produto
        </button>
      </div>

      {results.isFetching && <p className="text-sm">Buscando...</p>}
      {results.isSuccess && results.data.data.length === 0 && (
        <p className="text-sm">Nenhum produto encontrado.</p>
      )}
      {results.isSuccess && results.data.data.length > 0 && (
        <ul className="space-y-1">
          {results.data.data.map((product) => (
            <li key={product.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="produto"
                  value={product.id}
                  checked={product.id === selectedId}
                  onChange={() => onSelect(product)}
                />
                <span>
                  <span className="font-mono text-xs">{product.sku}</span>{' '}
                  {product.name} (saldo {product.currentStock})
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id="produto-erro" className="text-sm text-red-700">
          {error.message}
        </p>
      )}
    </fieldset>
  );
}
