import type { ReactNode } from 'react';

interface Props {
  id: string;
  label: string;
  error?: { message?: string };
  hint?: string;
  children: ReactNode;
}

/**
 * Rótulo + campo + mensagem de erro. O campo (children) recebe os atributos
 * de fieldA11y(id, error) para ficar ligado ao rótulo e ao erro.
 */
export function Field({ id, label, error, hint, children }: Props) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
      {error && (
        <p id={`${id}-erro`} className="mt-1 text-sm text-red-700">
          {error.message}
        </p>
      )}
    </div>
  );
}
