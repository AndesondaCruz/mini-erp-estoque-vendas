import { ApiError } from '../lib/api';

/** Mensagem de erro da API, com o requestId para o suporte achar no log. */
export function ErrorMessage({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : 'Algo deu errado. Tente de novo.';
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <p>{message}</p>
      {requestId && (
        <p className="mt-1 text-xs text-red-700">
          Código para o suporte: <code>{requestId}</code>
        </p>
      )}
    </div>
  );
}
