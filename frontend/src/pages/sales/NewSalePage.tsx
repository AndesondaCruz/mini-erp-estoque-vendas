import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  dangerLinkButton,
  fieldA11y,
  inputClass,
  primaryButton,
  secondaryButton,
} from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { formatCents, formatMoney, toCents } from '../../lib/money';
import type { Product, Sale } from '../../lib/types';
import { MAX_QUANTITY, MAX_SALE_ITEMS } from '../../lib/types';
import { SaleProductSearch } from './SaleProductSearch';

/** Linha do carrinho. A quantidade fica como texto, como o campo. */
interface CartLine {
  product: Product;
  quantity: string;
}

interface SaleBody {
  items: { productId: string; quantity: number }[];
}

/** Valida o carrinho. Devolve os erros por produto, ou o corpo da API. */
function validate(cart: CartLine[]): {
  errors: Map<string, string>;
  body: SaleBody | null;
} {
  const errors = new Map<string, string>();
  for (const { product, quantity } of cart) {
    const text = quantity.trim();
    if (!/^\d+$/.test(text) || Number(text) < 1) {
      errors.set(product.id, 'Use um número inteiro a partir de 1');
    } else if (Number(text) > MAX_QUANTITY) {
      errors.set(product.id, `No máximo ${MAX_QUANTITY}`);
    } else if (Number(text) > product.currentStock) {
      // Saldo da última leitura: só evita um 409 óbvio. Quem decide é a API.
      errors.set(product.id, `Só há ${product.currentStock} em estoque`);
    }
  }
  if (errors.size > 0 || cart.length === 0) return { errors, body: null };
  return {
    errors,
    body: {
      items: cart.map(({ product, quantity }) => ({
        productId: product.id,
        quantity: Number(quantity.trim()),
      })),
    },
  };
}

/** 409 de estoque insuficiente: { productId, requested, available }. */
function shortageFrom(
  error: unknown,
): { productId: string; available: number } | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const details = error.details as
    { productId?: unknown; available?: unknown } | undefined;
  return typeof details?.productId === 'string' &&
    typeof details.available === 'number'
    ? { productId: details.productId, available: details.available }
    : undefined;
}

/** Sem resposta do servidor (rede caiu): a venda pode ter sido gravada ou não. */
const isNetworkError = (error: unknown) => error instanceof TypeError;
const NETWORK_MESSAGE =
  'Sem resposta do servidor: não deu para confirmar se a venda foi gravada. Tentar de novo é seguro, a mesma venda não é registrada duas vezes.';

export function NewSalePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');

  /**
   * Chave da tentativa atual. Nasce no primeiro envio e é REUSADA nos
   * reenvios do mesmo carrinho (é o que torna o "tentar de novo" seguro).
   * Qualquer mudança no carrinho apaga a chave: é outra venda.
   */
  const keyRef = useRef<string | null>(null);

  const save = useMutation({
    mutationFn: ({ body, key }: { body: SaleBody; key: string }) =>
      api<Sale>('/sales', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': key },
      }),
    onSuccess: async (sale) => {
      keyRef.current = null;
      // A venda mudou saldos, alertas e o extrato de estoque.
      await Promise.all(
        ['sales', 'products', 'stock-alerts', 'stock-movements'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      await navigate(`/vendas/${sale.id}`, {
        state: { notice: `Venda nº ${sale.number} registrada.` },
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        // Chave reaproveitada em outra venda: a próxima tentativa usa outra.
        keyRef.current = null;
      }
      // Alguém vendeu enquanto o carrinho estava aberto: atualiza o saldo
      // exibido daquele produto com o que a API informou.
      const shortage = shortageFrom(error);
      if (shortage) {
        setCart((lines) =>
          lines.map((line) =>
            line.product.id === shortage.productId
              ? {
                  ...line,
                  product: {
                    ...line.product,
                    currentStock: shortage.available,
                  },
                }
              : line,
          ),
        );
      }
    },
  });

  /** Toda mudança no carrinho é uma venda diferente: chave nova. */
  function changeCart(next: (lines: CartLine[]) => CartLine[]) {
    keyRef.current = null;
    save.reset();
    setCart(next);
  }

  function add(product: Product) {
    const existing = cart.find((line) => line.product.id === product.id);
    if (!existing && cart.length >= MAX_SALE_ITEMS) {
      setNotice(`Uma venda tem no máximo ${MAX_SALE_ITEMS} produtos.`);
      return;
    }
    // Produto repetido soma na mesma linha: a API recusa o mesmo produto em
    // dois itens.
    changeCart((lines) =>
      existing
        ? lines.map((line) =>
            line.product.id === product.id
              ? {
                  product,
                  quantity: String((Number(line.quantity) || 0) + 1),
                }
              : line,
          )
        : [...lines, { product, quantity: '1' }],
    );
    setNotice(`${product.name} no carrinho.`);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const { body } = validate(cart);
    if (!body) return;
    try {
      keyRef.current ??= newIdempotencyKey();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return;
    }
    save.mutate({ body, key: keyRef.current });
  }

  const { errors } = validate(cart);
  const shownErrors = submitted ? errors : new Map<string, string>();
  const shortage = shortageFrom(save.error);
  const totalCents = cart.reduce(
    (sum, { product, quantity }) =>
      sum +
      (/^\d+$/.test(quantity.trim())
        ? toCents(product.salePrice) * Number(quantity)
        : 0),
    0,
  );
  const inCart = new Map(
    cart.map(({ product, quantity }) => [product.id, Number(quantity) || 0]),
  );

  return (
    <section aria-labelledby="titulo-nova-venda" className="space-y-6">
      <h1 id="titulo-nova-venda" className="text-2xl font-semibold">
        Nova venda
      </h1>

      <SaleProductSearch inCart={inCart} onAdd={add} />

      {/* Região viva: anuncia "X no carrinho" sem tirar o foco da busca. */}
      <output className="block text-sm text-slate-700">{notice}</output>

      <form
        noValidate
        onSubmit={submit}
        aria-labelledby="titulo-carrinho"
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 id="titulo-carrinho" className="font-medium">
          Carrinho
        </h2>

        {cart.length === 0 ? (
          <p className="text-sm text-slate-600">
            Nenhum produto ainda. Busque acima e clique em Adicionar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Itens da venda</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Produto
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Preço
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Quantidade
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Subtotal
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cart.map(({ product, quantity }) => {
                  const id = `qtd-${product.id}`;
                  const message = shownErrors.get(product.id);
                  const error = message ? { message } : undefined;
                  const valid = /^\d+$/.test(quantity.trim());
                  return (
                    <tr
                      key={product.id}
                      className="border-b border-slate-100 align-top"
                    >
                      <td className="px-3 py-2">
                        {product.name}
                        <span className="block font-mono text-xs text-slate-600">
                          {product.sku}, saldo {product.currentStock}
                        </span>
                        {shortage?.productId === product.id && (
                          <span className="block text-sm font-medium text-red-800">
                            Disponível agora: {shortage.available}.
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {formatMoney(product.salePrice)}
                      </td>
                      <td className="px-3 py-2">
                        <label htmlFor={id} className="sr-only">
                          Quantidade de {product.name}
                        </label>
                        <input
                          {...fieldA11y(id, error)}
                          inputMode="numeric"
                          value={quantity}
                          onChange={(e) =>
                            changeCart((lines) =>
                              lines.map((line) =>
                                line.product.id === product.id
                                  ? { ...line, quantity: e.target.value }
                                  : line,
                              ),
                            )
                          }
                          className={`${inputClass} max-w-24`}
                        />
                        {message && (
                          <p
                            id={`${id}-erro`}
                            className="mt-1 text-sm text-red-700"
                          >
                            {message}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {valid
                          ? formatCents(
                              toCents(product.salePrice) * Number(quantity),
                            )
                          : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className={dangerLinkButton}
                          aria-label={`Remover ${product.name}`}
                          onClick={() => {
                            changeCart((lines) =>
                              lines.filter(
                                (line) => line.product.id !== product.id,
                              ),
                            );
                            setNotice(`${product.name} removido do carrinho.`);
                          }}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {submitted && cart.length === 0 && (
          <p className="text-sm text-red-700">
            Adicione pelo menos um produto.
          </p>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-200 pt-3">
          <p className="text-lg">
            Total:{' '}
            <strong data-testid="total-previa">
              {formatCents(totalCents)}
            </strong>
          </p>
          <p className="text-xs text-slate-600">
            Prévia com os preços da busca. O total confirmado é o calculado pelo
            servidor ao registrar.
          </p>
        </div>

        {save.isError && (
          <ErrorMessage
            error={
              isNetworkError(save.error)
                ? new Error(NETWORK_MESSAGE)
                : save.error
            }
          />
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            aria-busy={save.isPending}
            className={primaryButton}
          >
            {save.isPending ? 'Registrando...' : 'Registrar venda'}
          </button>
          <Link to="/vendas" className={secondaryButton}>
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
}
