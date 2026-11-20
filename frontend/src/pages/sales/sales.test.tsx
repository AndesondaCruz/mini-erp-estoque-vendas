import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { endOfDayExclusiveIso, startOfDayIso } from '../../lib/dates';
import { catalog } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

// Dados de teste (api-mock): Cerveja R$ 5,50 com saldo 4 e Sabão R$ 14,90
// com saldo 20. Vendas: nº 1 do VENDEDOR (1 sabão, 12/11, concluída) e nº 2
// do GERENTE (2 cervejas, 16/11, cancelada pelo ADMIN).

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stockOf = (id: string) =>
  catalog.products.find((p) => p.id === id)!.currentStock;

const salesTable = () => screen.findByRole('table', { name: 'Vendas' });
const bodyRows = async () =>
  within(await salesTable())
    .getAllByRole('row')
    .slice(1);

describe('SalesPage (lista)', () => {
  it('GERENTE vê todas as vendas, da mais recente para a mais antiga', async () => {
    renderAs('GERENTE', '/vendas');
    const [first, second] = await bodyRows();
    expect(first).toHaveTextContent('nº 2');
    expect(first).toHaveTextContent('Pessoa GERENTE');
    expect(first).toHaveTextContent('Cancelada');
    expect(second).toHaveTextContent('nº 1');
    expect(second).toHaveTextContent('Concluída');
    expect(second).toHaveTextContent(/R\$\s14,90/);
    expect(catalog.lastQuery?.get('sort')).toBe('createdAt');
    expect(catalog.lastQuery?.get('order')).toBe('desc');
  });

  it('VENDEDOR vê só as próprias vendas e um aviso explicando', async () => {
    renderAs('VENDEDOR', '/vendas');
    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Pessoa VENDEDOR');
    expect(
      screen.getByText('Aqui aparecem só as vendas que você registrou.'),
    ).toBeVisible();
  });

  it('filtro de situação, período e ordenação vão para a URL e para a API', async () => {
    const { router } = renderAs('ADMIN', '/vendas');
    const user = userEvent.setup();
    await salesTable();

    await user.selectOptions(screen.getByLabelText('Situação'), 'Concluída');
    // Coluna nova começa na ordem padrão da lista (desc); o 2º clique inverte.
    await user.click(screen.getByRole('button', { name: /Total/ }));
    await user.click(screen.getByRole('button', { name: /Total/ }));

    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('nº 1');
    expect(
      Object.fromEntries(new URLSearchParams(router.state.location.search)),
    ).toEqual({ status: 'CONCLUIDA', sort: 'total', order: 'asc' });
    expect(catalog.lastQuery?.get('status')).toBe('CONCLUIDA');
    expect(catalog.lastQuery?.get('sort')).toBe('total');
    expect(catalog.lastQuery?.get('order')).toBe('asc');
  });

  it('período: "até" inclui o dia inteiro', async () => {
    renderAs('GERENTE', '/vendas?de=2026-11-16&ate=2026-11-16');
    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('nº 2');
    expect(catalog.lastQuery?.get('from')).toBe(startOfDayIso('2026-11-16'));
    expect(catalog.lastQuery?.get('to')).toBe(
      endOfDayExclusiveIso('2026-11-16'),
    );
  });

  it('URL editada à mão: situação, ordenação e datas inválidas são ignoradas', async () => {
    renderAs('GERENTE', '/vendas?status=PAGA&sort=costPrice&de=ontem');
    expect(await bodyRows()).toHaveLength(2);
    expect(catalog.lastQuery?.has('status')).toBe(false);
    expect(catalog.lastQuery?.get('sort')).toBe('createdAt');
    expect(catalog.lastQuery?.has('from')).toBe(false);
  });

  it('a lista não tem violações de acessibilidade', async () => {
    const { container } = renderAs('GERENTE', '/vendas');
    await salesTable();
    await expectNoA11yViolations(container);
  });
});

describe('NewSalePage (registrar venda)', () => {
  type User = ReturnType<typeof userEvent.setup>;

  const search = async (user: User, text: string) =>
    user.type(
      await screen.findByLabelText('Buscar por nome ou SKU'),
      `${text}{Enter}`,
    );
  const add = async (user: User, name: RegExp) =>
    user.click(await screen.findByRole('button', { name }));
  const register = (user: User) =>
    user.click(screen.getByRole('button', { name: 'Registrar venda' }));

  it('soma o mesmo produto na mesma linha, mostra a prévia e registra', async () => {
    const { router } = renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'cer');
    await add(user, /^Adicionar Cerveja/);
    // Clicar de novo soma, em vez de criar um segundo item (a API recusa).
    await add(user, /^Adicionar mais um Cerveja/);

    expect(
      screen.getByLabelText('Quantidade de Cerveja lata 350 ml'),
    ).toHaveValue('2');
    expect(screen.getByTestId('total-previa')).toHaveTextContent(/R\$\s11,00/);
    await register(user);

    expect(
      await screen.findByRole('heading', { name: 'Venda nº 3' }),
    ).toBeVisible();
    expect(screen.getByText('Venda nº 3 registrada.')).toBeVisible();
    expect(router.state.location.pathname).toMatch(/^\/vendas\/venda-novo-/);
    // O corpo leva só produto e quantidade: o preço vem do banco (risco 6).
    expect(catalog.lastBody).toEqual({
      items: [{ productId: 'prod-cerveja', quantity: 2 }],
    });
    expect(catalog.saleKeys).toHaveLength(1);
    expect(catalog.saleKeys[0]).toMatch(UUID);
    expect(stockOf('prod-cerveja')).toBe(2);
  });

  it('Enter na busca não envia a venda; carrinho vazio não chega à API', async () => {
    renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'sab');
    await screen.findByRole('button', { name: /^Adicionar Sabão/ });
    expect(catalog.saleKeys).toHaveLength(0);

    await register(user);
    expect(screen.getByText('Adicione pelo menos um produto.')).toBeVisible();
    expect(catalog.saleKeys).toHaveLength(0);
  });

  it('valida a quantidade de cada linha antes de enviar', async () => {
    renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'cer');
    await add(user, /^Adicionar Cerveja/);
    const quantity = screen.getByLabelText('Quantidade de Cerveja lata 350 ml');

    await user.clear(quantity);
    await user.type(quantity, '5');
    await register(user);
    expect(screen.getByText('Só há 4 em estoque')).toBeVisible();
    expect(quantity).toHaveAttribute('aria-invalid', 'true');

    await user.clear(quantity);
    await user.type(quantity, '0');
    expect(
      screen.getByText('Use um número inteiro a partir de 1'),
    ).toBeVisible();
    expect(catalog.saleKeys).toHaveLength(0);
  });

  it('409 de estoque: mostra o disponível e atualiza o saldo da linha', async () => {
    renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'cer');
    await add(user, /^Adicionar Cerveja/);
    await add(user, /^Adicionar mais um Cerveja/);
    // Outro caixa vendeu 3 cervejas enquanto este carrinho estava aberto.
    catalog.products.find((p) => p.id === 'prod-cerveja')!.currentStock = 1;
    await register(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Estoque insuficiente',
    );
    expect(screen.getByText('Disponível agora: 1.')).toBeVisible();
    expect(screen.getByText('Só há 1 em estoque')).toBeVisible();
    expect(catalog.sales).toHaveLength(2);
  });

  it('rede cai depois de gravar: tentar de novo reusa a chave e não duplica', async () => {
    renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'sab');
    await add(user, /^Adicionar Sabão/);

    catalog.dropNextSaleResponse = true;
    await register(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tentar de novo é seguro',
    );
    // O servidor gravou: o estoque já baixou, mas a tela não sabe.
    expect(stockOf('prod-sabao')).toBe(19);

    await register(user);
    expect(
      await screen.findByRole('heading', { name: 'Venda nº 3' }),
    ).toBeVisible();
    expect(catalog.saleKeys).toHaveLength(2);
    expect(catalog.saleKeys[1]).toBe(catalog.saleKeys[0]);
    expect(catalog.sales).toHaveLength(3);
    expect(stockOf('prod-sabao')).toBe(19);
  });

  it('mudar o carrinho depois de uma falha gera uma chave nova', async () => {
    renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'sab');
    await add(user, /^Adicionar Sabão/);
    catalog.dropNextSaleResponse = true;
    await register(user);
    await screen.findByRole('alert');

    await add(user, /^Adicionar mais um Sabão/);
    // Mudou o carrinho: o erro antigo some, ele não vale para esta venda.
    expect(screen.queryByRole('alert')).toBeNull();
    await register(user);

    await screen.findByRole('heading', { name: /^Venda nº/ });
    expect(catalog.saleKeys).toHaveLength(2);
    expect(catalog.saleKeys[1]).toMatch(UUID);
    expect(catalog.saleKeys[1]).not.toBe(catalog.saleKeys[0]);
  });

  it('sem crypto.randomUUID (HTTP fora de localhost): avisa e não envia', async () => {
    vi.stubGlobal('crypto', {});
    try {
      renderAs('VENDEDOR', '/vendas/nova');
      const user = userEvent.setup();
      await search(user, 'sab');
      await add(user, /^Adicionar Sabão/);
      await register(user);
      expect(
        screen.getByText(/não gera a chave da venda fora de HTTPS/),
      ).toBeVisible();
      expect(catalog.saleKeys).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Remover tira o produto do carrinho e zera o total', async () => {
    renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'sab');
    await add(user, /^Adicionar Sabão/);
    await user.click(
      screen.getByRole('button', { name: 'Remover Sabão em pó 1 kg' }),
    );
    expect(screen.getByText(/Nenhum produto ainda/)).toBeVisible();
    expect(screen.getByTestId('total-previa')).toHaveTextContent(/R\$\s0,00/);
    expect(
      screen.getByText('Sabão em pó 1 kg removido do carrinho.'),
    ).toBeVisible();
  });

  it('o carrinho com erros não tem violações de acessibilidade', async () => {
    const { container } = renderAs('VENDEDOR', '/vendas/nova');
    const user = userEvent.setup();
    await search(user, 'cer');
    await add(user, /^Adicionar Cerveja/);
    const quantity = screen.getByLabelText('Quantidade de Cerveja lata 350 ml');
    await user.clear(quantity);
    await register(user);
    await screen.findByText('Use um número inteiro a partir de 1');
    await expectNoA11yViolations(container);
  });
});

describe('SaleDetailPage (detalhe e cancelamento)', () => {
  const itemsTable = () =>
    screen.findByRole('table', { name: 'Itens da venda' });

  it('GERENTE vê o custo dos itens; VENDEDOR não vê custo nem cancelar', async () => {
    renderAs('GERENTE', '/vendas/venda-1');
    expect(
      within(await itemsTable()).getByRole('columnheader', {
        name: 'Custo unitário',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Cancelar venda' }),
    ).toBeVisible();
  });

  it('VENDEDOR vê a própria venda sem custo e sem o botão de cancelar', async () => {
    renderAs('VENDEDOR', '/vendas/venda-1');
    const table = await itemsTable();
    expect(within(table).queryByText('Custo unitário')).toBeNull();
    expect(within(table).queryByText(/9,90/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar venda' })).toBeNull();
  });

  it('VENDEDOR abrindo a venda de outra pessoa: 404, sem revelar que existe', async () => {
    renderAs('VENDEDOR', '/vendas/venda-2');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Venda não encontrada',
    );
  });

  it('venda cancelada mostra quem cancelou e o motivo, sem o botão', async () => {
    renderAs('ADMIN', '/vendas/venda-2');
    await itemsTable();
    expect(screen.getByText('Cliente desistiu')).toBeVisible();
    expect(screen.getByText(/por Pessoa ADMIN/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancelar venda' })).toBeNull();
  });

  it('cancelar: exige motivo, devolve o estoque e mostra a venda cancelada', async () => {
    renderAs('GERENTE', '/vendas/venda-1');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar venda' }),
    );
    const reason = screen.getByLabelText('Motivo do cancelamento');
    // O foco vai direto para o campo que acabou de aparecer.
    expect(reason).toHaveFocus();

    await user.click(
      screen.getByRole('button', { name: 'Confirmar cancelamento' }),
    );
    expect(screen.getByText('Informe o motivo do cancelamento')).toBeVisible();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(catalog.lastBody).toBeNull();

    await user.type(reason, '  Troca de produto  ');
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cancelamento' }),
    );

    expect(
      await screen.findByText(
        'Venda cancelada. O estoque de todos os itens foi devolvido.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Cancelada', { selector: 'span' })).toBeVisible();
    expect(screen.getByText('Troca de produto')).toBeVisible();
    expect(catalog.lastBody).toEqual({ reason: 'Troca de produto' });
    expect(stockOf('prod-sabao')).toBe(21);
    expect(screen.queryByRole('button', { name: 'Cancelar venda' })).toBeNull();
  });

  it('"Manter a venda" fecha o formulário e devolve o foco ao botão', async () => {
    renderAs('ADMIN', '/vendas/venda-1');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar venda' }),
    );
    await user.click(screen.getByRole('button', { name: 'Manter a venda' }));
    expect(screen.queryByLabelText('Motivo do cancelamento')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Cancelar venda' }),
    ).toHaveFocus();
  });

  it('409: outra pessoa cancelou antes, a tela explica e atualiza', async () => {
    renderAs('GERENTE', '/vendas/venda-1');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar venda' }),
    );
    catalog.sales.find((s) => s.id === 'venda-1')!.status = 'CANCELADA';
    await user.type(screen.getByLabelText('Motivo do cancelamento'), 'Erro');
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cancelamento' }),
    );

    expect(
      await screen.findByText(
        'Esta venda já tinha sido cancelada por outra pessoa.',
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Confirmar cancelamento' }),
      ).toBeNull(),
    );
    // Nada foi estornado duas vezes.
    expect(stockOf('prod-sabao')).toBe(20);
  });

  it('o formulário de cancelamento com erro não tem violações de acessibilidade', async () => {
    const { container } = renderAs('GERENTE', '/vendas/venda-1');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar venda' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cancelamento' }),
    );
    await screen.findByText('Informe o motivo do cancelamento');
    await expectNoA11yViolations(container);
  });
});
