import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { startOfDayIso, endOfDayExclusiveIso } from '../../lib/dates';
import { http, HttpResponse } from 'msw';
import { catalog, server } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

// Catálogo de teste (api-mock): Cerveja com saldo 4 (mínimo 10) e Sabão com
// saldo 20. Movimentações: ENTRADA +4 da cerveja em 10/11 e SAIDA -2 do sabão
// em 15/11.

const table = () =>
  screen.findByRole('table', { name: 'Movimentações de estoque' });
/** Linhas do corpo da tabela (sem o cabeçalho). */
const bodyRows = async () =>
  within(await table())
    .getAllByRole('row')
    .slice(1);
/** "Selecionado: <strong>Nome</strong>, saldo atual <strong>N</strong>" */
const selected = (text: string) =>
  screen.findByText(
    (_, el) =>
      el?.tagName === 'P' && el.textContent?.startsWith(`Selecionado: ${text}`),
  );

describe('StockPage (extrato)', () => {
  it('mostra o extrato do mais recente para o mais antigo, com sinal', async () => {
    renderAs('GERENTE', '/estoque');
    const [first, second] = await bodyRows();
    expect(first).toHaveTextContent('Sabão em pó 1 kg');
    expect(first).toHaveTextContent('Saída');
    expect(first).toHaveTextContent('-2');
    expect(first).toHaveTextContent('Embalagem rasgada');
    expect(second).toHaveTextContent('Cerveja lata 350 ml');
    expect(second).toHaveTextContent('+4');
    expect(second).toHaveTextContent('Pessoa GERENTE');
    expect(catalog.lastPath).toBe('/stock/movements');
  });

  it('filtro de tipo e ordenação vão para a URL e para a API', async () => {
    const { router } = renderAs('ADMIN', '/estoque');
    const user = userEvent.setup();
    await table();

    await user.selectOptions(screen.getByLabelText('Tipo'), 'Entrada');
    await user.click(screen.getByRole('button', { name: /Data/ }));

    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Cerveja lata 350 ml');
    expect(
      Object.fromEntries(new URLSearchParams(router.state.location.search)),
    ).toEqual({ tipo: 'ENTRADA', ordem: 'asc' });
    expect(catalog.lastQuery?.get('type')).toBe('ENTRADA');
    expect(catalog.lastQuery?.get('order')).toBe('asc');
  });

  it('período: "até" inclui o dia inteiro (fim exclusivo no dia seguinte)', async () => {
    renderAs('GERENTE', '/estoque?de=2026-11-12&ate=2026-11-15');
    const rows = await bodyRows();
    // A saída de 15/11 entra: o filtro vai até 16/11 00:00, exclusivo.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Sabão em pó 1 kg');
    expect(catalog.lastQuery?.get('from')).toBe(startOfDayIso('2026-11-12'));
    expect(catalog.lastQuery?.get('to')).toBe(
      endOfDayExclusiveIso('2026-11-15'),
    );
  });

  it('URL editada à mão: tipo e datas inválidos são ignorados', async () => {
    renderAs('GERENTE', '/estoque?tipo=HACK&de=ontem&ate=2026-13');
    expect(await bodyRows()).toHaveLength(2);
    expect(catalog.lastQuery?.has('type')).toBe(false);
    expect(catalog.lastQuery?.has('from')).toBe(false);
    expect(catalog.lastQuery?.has('to')).toBe(false);
  });

  it('clicar no produto abre o histórico dele e dá para voltar', async () => {
    renderAs('GERENTE', '/estoque');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Ver movimentações de Sabão em pó 1 kg',
      }),
    );

    expect(
      await screen.findByText('SAB-1KG - Sabão em pó 1 kg (saldo 20)'),
    ).toBeVisible();
    expect(await bodyRows()).toHaveLength(1);
    expect(catalog.lastPath).toBe('/products/prod-sabao/movements');

    await user.click(
      screen.getByRole('button', { name: 'Ver todos os produtos' }),
    );
    // O extrato geral volta do cache do React Query (mesma queryKey), sem
    // nova requisição; waitFor porque a troca não é síncrona.
    await waitFor(async () => expect(await bodyRows()).toHaveLength(2));
    expect(screen.queryByText(/SAB-1KG - Sabão/)).toBeNull();
  });

  it('produto inexistente na URL: avisa em vez de "carregando" para sempre', async () => {
    renderAs('GERENTE', '/estoque?produto=nao-existe');
    expect(await screen.findByText('produto não encontrado')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Produto não encontrado',
    );
  });

  it('VENDEDOR abrindo /estoque pelo endereço: 403', async () => {
    renderAs('VENDEDOR', '/estoque');
    expect(
      await screen.findByRole('heading', { name: 'Sem permissão' }),
    ).toBeVisible();
  });

  it('o extrato não tem violações de acessibilidade', async () => {
    const { container } = renderAs('GERENTE', '/estoque');
    await table();
    await expectNoA11yViolations(container);
  });
});

describe('MovementFormPage (lançamento)', () => {
  const submit = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(await screen.findByRole('button', { name: 'Registrar' }));

  it('ENTRADA: envia só os campos do tipo e abre o extrato do produto', async () => {
    const { router } = renderAs(
      'GERENTE',
      '/estoque/nova?produto=prod-cerveja',
    );
    const user = userEvent.setup();
    expect(await selected('Cerveja lata 350 ml')).toBeVisible();

    await user.type(screen.getByLabelText('Quantidade'), '6');
    await submit(user);

    expect(await table()).toBeVisible();
    expect(router.state.location.pathname).toBe('/estoque');
    expect(router.state.location.search).toBe('?produto=prod-cerveja');
    // Motivo vazio na ENTRADA não vai para a API.
    expect(catalog.lastBody).toEqual({
      type: 'ENTRADA',
      productId: 'prod-cerveja',
      quantity: 6,
    });
    const [newest] = await bodyRows();
    expect(newest).toHaveTextContent('+6');
    expect(newest).toHaveTextContent('10'); // saldo depois: 4 + 6
  });

  it('validação: produto, quantidade e motivo obrigatório na SAÍDA', async () => {
    renderAs('GERENTE', '/estoque/nova');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /^Saída/ }));
    await submit(user);

    expect(await screen.findByText('Escolha o produto')).toBeVisible();
    expect(screen.getByText('Use um número inteiro')).toBeVisible();
    expect(screen.getByText('Informe o motivo')).toBeVisible();
    expect(screen.getByLabelText('Quantidade')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(catalog.lastBody).toBeNull();
  });

  it('AJUSTE: troca o campo, mostra a prévia e não envia quantity', async () => {
    renderAs('ADMIN', '/estoque/nova?produto=prod-cerveja');
    const user = userEvent.setup();
    await selected('Cerveja lata 350 ml');

    // Digitado na ENTRADA e abandonado: não pode chegar à API no AJUSTE.
    await user.type(screen.getByLabelText('Quantidade'), '99');
    await user.click(screen.getByRole('radio', { name: /^Ajuste/ }));
    expect(screen.queryByLabelText('Quantidade')).toBeNull();

    await user.type(screen.getByLabelText('Saldo contado'), '7');
    expect(screen.getByTestId('previa-ajuste')).toHaveTextContent(
      'Ajuste de +3 (de 4 para 7).',
    );
    await user.type(screen.getByLabelText('Motivo'), 'Inventário de novembro');
    await submit(user);

    expect(await table()).toBeVisible();
    expect(catalog.lastBody).toEqual({
      type: 'AJUSTE',
      productId: 'prod-cerveja',
      countedStock: 7,
      reason: 'Inventário de novembro',
    });
  });

  it('AJUSTE sem diferença: a prévia avisa e o 400 da API aparece', async () => {
    renderAs('GERENTE', '/estoque/nova?produto=prod-cerveja');
    const user = userEvent.setup();
    await selected('Cerveja lata 350 ml');
    await user.click(screen.getByRole('radio', { name: /^Ajuste/ }));
    await user.type(screen.getByLabelText('Saldo contado'), '4');
    expect(screen.getByTestId('previa-ajuste')).toHaveTextContent(
      'Sem diferença: o saldo já é 4.',
    );
    await user.type(screen.getByLabelText('Motivo'), 'Conferência');
    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O saldo já é 4: não há diferença para ajustar',
    );
  });

  it('SAÍDA maior que o saldo: mostra o erro e o disponível', async () => {
    renderAs('GERENTE', '/estoque/nova?produto=prod-cerveja');
    const user = userEvent.setup();
    await selected('Cerveja lata 350 ml');
    await user.click(screen.getByRole('radio', { name: /^Saída/ }));
    await user.type(screen.getByLabelText('Quantidade'), '5');
    await user.type(screen.getByLabelText('Motivo'), 'Quebra');
    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Estoque insuficiente',
    );
    expect(screen.getByText('Disponível agora: 4.')).toBeVisible();
    // Nada mudou no "banco".
    expect(
      catalog.products.find((p) => p.id === 'prod-cerveja')?.currentStock,
    ).toBe(4);
  });

  it('Cancelar volta para o extrato do produto de onde veio', async () => {
    renderAs('GERENTE', '/estoque/nova?produto=prod-cerveja');
    expect(
      await screen.findByRole('link', { name: 'Cancelar' }),
    ).toHaveAttribute('href', '/estoque?produto=prod-cerveja');
  });

  it('busca de produto: Enter busca sem enviar o formulário', async () => {
    renderAs('GERENTE', '/estoque/nova');
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('Buscar por nome ou SKU'),
      'sab{Enter}',
    );
    await user.click(await screen.findByRole('radio', { name: /Sabão em pó/ }));

    expect(await selected('Sabão em pó 1 kg, saldo atual 20')).toBeVisible();
    expect(catalog.lastBody).toBeNull();
    expect(screen.queryByText('Escolha o produto')).toBeNull();
  });

  it('nova busca antes da resposta da anterior: a anterior é abortada', async () => {
    // A primeira busca ("cer") fica presa no servidor até ser abortada (ou
    // até 1 s, para o teste falhar em vez de travar). As outras seguem para
    // o handler normal do mock.
    const signals: Record<string, AbortSignal> = {};
    server.use(
      http.get('*/api/v1/products', async ({ request }) => {
        const search = new URL(request.url).searchParams.get('search') ?? '';
        signals[search] = request.signal;
        if (search !== 'cer') return undefined;
        await Promise.race([
          new Promise((resolve) =>
            request.signal.addEventListener('abort', resolve),
          ),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
        return HttpResponse.error();
      }),
    );
    renderAs('GERENTE', '/estoque/nova');
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Buscar por nome ou SKU');

    await user.type(input, 'cer{Enter}');
    await waitFor(() => expect(signals.cer).toBeDefined());
    await user.clear(input);
    await user.type(input, 'sab{Enter}');

    expect(
      await screen.findByRole('radio', { name: /Sabão em pó/ }),
    ).toBeVisible();
    expect(signals.cer.aborted).toBe(true);
    expect(signals.sab.aborted).toBe(false);
  });

  it('o formulário com erros não tem violações de acessibilidade', async () => {
    const { container } = renderAs('GERENTE', '/estoque/nova');
    const user = userEvent.setup();
    await submit(user);
    await screen.findByText('Escolha o produto');
    await expectNoA11yViolations(container);
  });
});

describe('HomePage (alertas)', () => {
  it('lista os produtos com maior falta e leva à lista filtrada', async () => {
    renderAs('VENDEDOR', '/');
    const alerts = await screen.findByRole('table', {
      name: 'Produtos com maior falta de estoque',
    });
    const [row] = within(alerts).getAllByRole('row').slice(1);
    expect(row).toHaveTextContent('Cerveja lata 350 ml');
    expect(row).toHaveTextContent('4 / 10');
    expect(row).toHaveTextContent('6');
    expect(
      screen.getByRole('link', {
        name: 'Ver todos os produtos com estoque baixo',
      }),
    ).toHaveAttribute('href', '/produtos?baixo=1');
  });
});
