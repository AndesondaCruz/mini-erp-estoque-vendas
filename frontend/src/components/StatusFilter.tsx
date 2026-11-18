import { STATUS_OPTIONS } from '../lib/list-params';
import { inputClass } from './ui';

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
}

/** Ativos (padrão), inativos ou todos. */
export function StatusFilter({ value, onChange }: Props) {
  return (
    <div>
      <label
        htmlFor="filtro-situacao"
        className="mb-1 block text-sm font-medium"
      >
        Situação
      </label>
      <select
        id="filtro-situacao"
        value={value ?? 'ativos'}
        onChange={(e) =>
          onChange(e.target.value === 'ativos' ? null : e.target.value)
        }
        className={inputClass}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
