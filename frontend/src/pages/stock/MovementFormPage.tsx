import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import {
  fieldA11y,
  inputClass,
  primaryButton,
  secondaryButton,
} from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import type {
  ManualMovementType,
  Product,
  StockMovement,
} from '../../lib/types';
import { MOVEMENT_LABELS } from '../../lib/types';
import { ProductPicker } from './ProductPicker';

const MAX_STOCK = 1_000_000;

/** Texto do campo -> inteiro, com o mínimo de cada tipo. */
const integer = (min: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, 'Use um número inteiro')
    .transform(Number)
    .pipe(
      z.number().min(min, message).max(MAX_STOCK, `No máximo ${MAX_STOCK}`),
    );

const productId = z.string().min(1, 'Escolha o produto');
const requiredReason = z
  .string()
  .trim()
  .min(1, 'Informe o motivo')
  .max(255, 'Use até 255 caracteres');
// Na ENTRADA o motivo é opcional: vazio não vai para a API.
const optionalReason = z
  .string()
  .trim()
  .max(255, 'Use até 255 caracteres')
  .transform((value) => (value === '' ? undefined : value));

/**
 * Um schema por tipo, escolhido pelo campo `type`. É o espelho do
 * @ValidateIf do DTO: AJUSTE sem countedStock ou SAIDA sem motivo nem chegam
 * à API. O z.object descarta os campos dos outros tipos, então a API não
 * recebe `quantity` num AJUSTE (o que responderia 400).
 */
const schema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ENTRADA'),
    productId,
    quantity: integer(1, 'A quantidade deve ser pelo menos 1'),
    reason: optionalReason,
  }),
  z.object({
    type: z.literal('SAIDA'),
    productId,
    quantity: integer(1, 'A quantidade deve ser pelo menos 1'),
    reason: requiredReason,
  }),
  z.object({
    type: z.literal('AJUSTE'),
    productId,
    countedStock: integer(0, 'O saldo contado não pode ser negativo'),
    reason: requiredReason,
  }),
]);
type FormOutput = z.output<typeof schema>;

/** O formulário guarda tudo como texto; o schema converte ao enviar. */
interface FormValues {
  type: ManualMovementType;
  productId: string;
  quantity: string;
  countedStock: string;
  reason: string;
}

const TYPE_HELP: Record<ManualMovementType, string> = {
  ENTRADA: 'Mercadoria que chegou.',
  SAIDA:
    'Perda, quebra, consumo interno. Venda não: venda é na tela de vendas.',
  AJUSTE: 'Contagem de inventário: informe quanto há na prateleira.',
};

/** 409 de estoque insuficiente traz o saldo disponível em details. */
function availableFrom(error: unknown): number | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const details = error.details as { available?: unknown } | undefined;
  return typeof details?.available === 'number' ? details.available : undefined;
}

export function MovementFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const form = useForm<FormValues, unknown, FormOutput>({
    // A tela guarda os campos de todos os tipos ao mesmo tempo (trocar de
    // ENTRADA para AJUSTE não apaga o que foi digitado), mas o schema é uma
    // união: cada ramo só conhece os seus campos. O cast diz ao TypeScript
    // que a entrada é FormValues; a saída continua tipada pelo schema.
    resolver: zodResolver(schema) as unknown as Resolver<
      FormValues,
      unknown,
      FormOutput
    >,
    defaultValues: {
      type: 'ENTRADA',
      productId: params.get('produto') ?? '',
      quantity: '',
      countedStock: '',
      reason: '',
    },
  });
  const { errors, isSubmitted } = form.formState;
  const [type, selectedId, countedText] = useWatch({
    control: form.control,
    name: ['type', 'productId', 'countedStock'],
  });

  // Saldo sempre buscado do servidor (não do resultado da busca), para a
  // prévia do ajuste e o "disponível" usarem o número mais recente possível.
  const product = useQuery({
    queryKey: ['products', 'detail', selectedId],
    queryFn: ({ signal }) =>
      api<Product>(`/products/${selectedId}`, { signal }),
    enabled: selectedId !== '',
  });

  const save = useMutation({
    mutationFn: (body: FormOutput) =>
      api<StockMovement>('/stock/movements', { method: 'POST', body }),
    onSuccess: async (movement) => {
      await Promise.all(
        ['stock-movements', 'products', 'stock-alerts'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      await navigate(`/estoque?produto=${movement.product.id}`);
    },
    onError: async (error) => {
      // O saldo mudou desde que a tela abriu: atualiza o que está exibido.
      if (availableFrom(error) !== undefined) await product.refetch();
    },
  });

  const available = availableFrom(save.error);
  const current = product.data?.currentStock;
  const counted = /^\d+$/.test(countedText.trim())
    ? Number(countedText)
    : undefined;
  const delta =
    current !== undefined && counted !== undefined ? counted - current : null;

  return (
    <section
      aria-labelledby="titulo-movimentacao"
      className="max-w-2xl space-y-6"
    >
      <h1 id="titulo-movimentacao" className="text-2xl font-semibold">
        Nova movimentação
      </h1>
      <form
        noValidate
        onSubmit={(e) => void form.handleSubmit((body) => save.mutate(body))(e)}
        className="space-y-5 rounded-lg border border-slate-200 bg-white p-6"
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Tipo</legend>
          {(['ENTRADA', 'SAIDA', 'AJUSTE'] as const).map((value) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                value={value}
                className="mt-1"
                {...form.register('type')}
              />
              <span>
                <span className="font-medium">{MOVEMENT_LABELS[value]}</span>
                <span className="block text-slate-600">{TYPE_HELP[value]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <ProductPicker
          selectedId={selectedId || null}
          error={errors.productId}
          onSelect={(picked) =>
            form.setValue('productId', picked.id, {
              shouldValidate: isSubmitted,
            })
          }
        />
        {product.data && (
          <p className="text-sm">
            Selecionado: <strong>{product.data.name}</strong>, saldo atual{' '}
            <strong>{product.data.currentStock}</strong>
            {!product.data.active && ' (produto inativo)'}
          </p>
        )}
        {product.isError && <ErrorMessage error={product.error} />}

        {type === 'AJUSTE' ? (
          <Field id="contado" label="Saldo contado" error={errors.countedStock}>
            <input
              {...fieldA11y('contado', errors.countedStock)}
              inputMode="numeric"
              className={inputClass}
              {...form.register('countedStock')}
            />
          </Field>
        ) : (
          <Field id="quantidade" label="Quantidade" error={errors.quantity}>
            <input
              {...fieldA11y('quantidade', errors.quantity)}
              inputMode="numeric"
              className={inputClass}
              {...form.register('quantity')}
            />
          </Field>
        )}

        {type === 'AJUSTE' && delta !== null && (
          // Prévia: o servidor recalcula a diferença sob lock ao salvar.
          <p className="text-sm" data-testid="previa-ajuste">
            {delta === 0
              ? `Sem diferença: o saldo já é ${current}.`
              : `Ajuste de ${delta > 0 ? `+${delta}` : delta} (de ${current} para ${counted}).`}
          </p>
        )}

        <Field
          id="motivo"
          label={type === 'ENTRADA' ? 'Motivo (opcional)' : 'Motivo'}
          error={errors.reason}
        >
          <input
            {...fieldA11y('motivo', errors.reason)}
            className={inputClass}
            {...form.register('reason')}
          />
        </Field>

        {save.isError && <ErrorMessage error={save.error} />}
        {available !== undefined && (
          <p className="text-sm font-medium text-red-800">
            Disponível agora: {available}.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            aria-busy={save.isPending}
            className={primaryButton}
          >
            {save.isPending ? 'Registrando...' : 'Registrar'}
          </button>
          {/* Veio do "Lançar" de um produto: volta para o extrato dele. */}
          <Link
            to={
              params.get('produto')
                ? `/estoque?produto=${params.get('produto')}`
                : '/estoque'
            }
            className={secondaryButton}
          >
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
}
