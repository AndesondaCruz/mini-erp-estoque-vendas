import { useState } from 'react';
import { inputClass, secondaryButton } from './ui';

interface Props {
  label: string;
  value: string;
  onSearch: (value: string) => void;
}

/**
 * Busca enviada no Enter ou no botão, não a cada tecla: sem debounce, sem
 * uma requisição por letra e sem resultados chegando fora de ordem.
 */
export function SearchForm({ label, value, onSearch }: Props) {
  const [text, setText] = useState(value);

  // <search> é o elemento HTML do landmark de busca (antes, role="search").
  return (
    <search>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(text.trim());
        }}
        className="flex items-end gap-2"
      >
        <div className="grow">
          <label htmlFor="busca" className="mb-1 block text-sm font-medium">
            {label}
          </label>
          <input
            id="busca"
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
  );
}
