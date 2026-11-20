import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import {
  dangerButton,
  fieldA11y,
  inputClass,
  linkButton,
  secondaryButton,
} from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { MANAGERS } from '../../lib/navigation';
import type { Sale } from '../../lib/types';
import { SaleStatusBadge } from './SaleStatusBadge';

const MAX_REASON = 255;

export function SaleDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  // Aviso vindo da tela de nova venda ("Venda nº 12 registrada.").
  const created = (location.state as { notice?: string } | null)?.notice;
  const [notice, setNotice] = useState(created ?? '');

  const query = useQuery({
    queryKey: ['sales', 'detail', id],
    queryFn: () => api<Sale>(`/sales/${id}`),
  });

  const canCancel =
    user !== null &&
    MANAGERS.includes(user.role) &&
    query.data?.status === 'CONCLUIDA';

  return (
    <section aria-labelledby="titulo-venda" className="max-w-3xl space-y-6">
      <Link to="/vendas" className={linkButton}>
        Voltar para as vendas
      </Link>

      {query.isPending && <Spinner label="Carregando venda" />}
      {query.isError && (
        <>
          <h1 id="titulo-venda" className="text-2xl font-semibold">
            Venda
          </h1>
          <ErrorMessage error={query.error} />
        </>
      )}
      {query.isSuccess && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 id="titulo-venda" className="text-2xl font-semibold">
              Venda nº {query.data.number}
            </h1>
            <SaleStatusBadge status={query.data.status} />
          </div>

          <output className="block text-sm text-green-800">{notice}</output>

          <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-600">Data</dt>
              <dd>{formatDateTime(query.data.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-600">Vendedor</dt>
              <dd>{query.data.seller.name}</dd>
            </div>
            <div>
              <dt className="text-slate-600">Total</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(query.data.total)}
              </dd>
            </div>
            {query.data.canceledAt && (
              <div>
                <dt className="text-slate-600">Cancelada</dt>
                <dd>
                  {formatDateTime(query.data.canceledAt)}
                  {query.data.canceledBy &&
                    ` por ${query.data.canceledBy.name}`}
                </dd>
              </div>
            )}
            {query.data.cancelReason && (
              <div className="sm:col-span-2">
                <dt className="text-slate-600">Motivo do cancelamento</dt>
                <dd>{query.data.cancelReason}</dd>
              </div>
            )}
          </dl>

          <ItemsTable sale={query.data} />

          {canCancel && (
            <CancelSale
              sale={query.data}
              onCanceled={(sale) => {
                queryClient.setQueryData(['sales', 'detail', id], sale);
                setNotice(
                  'Venda cancelada. O estoque de todos os itens foi devolvido.',
                );
                // Lista, saldos, alertas e extrato mudaram com o estorno.
                void Promise.all(
                  ['sales', 'products', 'stock-alerts', 'stock-movements'].map(
                    (key) => queryClient.invalidateQueries({ queryKey: [key] }),
                  ),
                );
              }}
              onAlreadyCanceled={() => {
                // O formulário some quando a venda recarrega como CANCELADA;
                // o aviso fica na página para a pessoa entender o porquê.
                setNotice(
                  'Esta venda já tinha sido cancelada por outra pessoa.',
                );
                void queryClient.invalidateQueries({ queryKey: ['sales'] });
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function ItemsTable({ sale }: { sale: Sale }) {
  // O custo só vem para ADMIN e GERENTE: a coluna aparece se a API mandou.
  const showCost = sale.items.some((item) => item.unitCost !== undefined);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse bg-white text-left text-sm">
        <caption className="sr-only">Itens da venda</caption>
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th scope="col" className="px-3 py-2">
              Produto
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Quantidade
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Preço unitário
            </th>
            {showCost && (
              <th scope="col" className="px-3 py-2 text-right">
                Custo unitário
              </th>
            )}
            <th scope="col" className="px-3 py-2 text-right">
              Subtotal
            </th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.product.id} className="border-b border-slate-100">
              <td className="px-3 py-2">
                {item.product.name}
                <span className="block font-mono text-xs text-slate-600">
                  {item.product.sku}
                </span>
              </td>
              <td className="px-3 py-2 text-right">{item.quantity}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {formatMoney(item.unitPrice)}
              </td>
              {showCost && (
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {item.unitCost ? formatMoney(item.unitCost) : '-'}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {formatMoney(item.subtotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Cancelamento em dois passos: o botão abre o campo do motivo, e só o
 * segundo botão chama a API. Não é um window.confirm porque o motivo é
 * obrigatório e o confirm não tem campo de texto.
 */
function CancelSale({
  sale,
  onCanceled,
  onAlreadyCanceled,
}: {
  sale: Sale;
  onCanceled: (sale: Sale) => void;
  onAlreadyCanceled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Foco: ao abrir, vai para o motivo (o campo que acabou de aparecer); ao
  // fechar com "Manter a venda", volta para o botão que abriu. Sem isso, o
  // foco cairia no <body> e o teclado recomeçaria do topo da página.
  useEffect(() => {
    if (open) reasonRef.current?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const cancel = useMutation({
    mutationFn: (text: string) =>
      api<Sale>(`/sales/${sale.id}/cancel`, {
        method: 'POST',
        body: { reason: text },
      }),
    onSuccess: onCanceled,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) onAlreadyCanceled();
    },
  });

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={secondaryButton}
      >
        Cancelar venda
      </button>
    );
  }

  const fieldError = error ? { message: error } : undefined;

  return (
    <form
      noValidate
      aria-labelledby="titulo-cancelar"
      onSubmit={(e) => {
        e.preventDefault();
        const text = reason.trim();
        if (text === '') return setError('Informe o motivo do cancelamento');
        if (text.length > MAX_REASON) {
          return setError(`Use até ${MAX_REASON} caracteres`);
        }
        setError('');
        cancel.mutate(text);
      }}
      className="space-y-4 rounded-lg border border-red-200 bg-red-50 p-4"
    >
      <h2 id="titulo-cancelar" className="font-medium text-red-900">
        Cancelar a venda nº {sale.number}
      </h2>
      <p className="text-sm">
        Todos os itens voltam para o estoque. O cancelamento não pode ser
        desfeito e fica registrado na auditoria.
      </p>
      <div>
        <label htmlFor="motivo" className="mb-1 block text-sm font-medium">
          Motivo do cancelamento
        </label>
        <textarea
          ref={reasonRef}
          {...fieldA11y('motivo', fieldError)}
          rows={3}
          maxLength={MAX_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputClass}
        />
        {error && (
          <p id="motivo-erro" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      {cancel.isError && <ErrorMessage error={cancel.error} />}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={cancel.isPending}
          aria-busy={cancel.isPending}
          className={dangerButton}
        >
          {cancel.isPending ? 'Cancelando...' : 'Confirmar cancelamento'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason('');
            setError('');
            cancel.reset();
          }}
          className={secondaryButton}
        >
          Manter a venda
        </button>
      </div>
    </form>
  );
}
