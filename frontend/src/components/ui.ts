// Classes repetidas entre telas. Um lugar só para mudar o visual.

export const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 aria-[invalid=true]:border-red-600';

export const primaryButton =
  'inline-block rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:opacity-60';

export const secondaryButton =
  'inline-block rounded-md border border-slate-300 px-4 py-2 hover:bg-slate-50 disabled:opacity-60';

export const linkButton =
  'text-sm font-medium text-indigo-700 underline-offset-2 hover:underline disabled:opacity-60';

export const dangerLinkButton =
  'text-sm font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-60';

/**
 * Atributos de acessibilidade de um campo com erro: o leitor de tela anuncia
 * "inválido" e lê a mensagem ligada pelo aria-describedby.
 */
export function fieldA11y(id: string, error?: { message?: string }) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-erro` : undefined,
  } as const;
}
