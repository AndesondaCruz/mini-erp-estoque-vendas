import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { niceTicks } from '../../components/ColumnChart';
import type { Sale } from '../../lib/types';
import { catalog } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

// "Hoje" fixo: 20/11/2026 (sexta). Só o Date é falso; os timers continuam
// reais para o user-event e o MSW.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 20, 12) });
});
afterEach(() => vi.useRealTimers());

// Dados (api-mock): venda nº 1 concluída em 12/11 (1 sabão, R$ 14,90) e
// nº 2 CANCELADA em 16/11 (não entra nos relatórios). Estoque: cerveja 4 un.
// (custo 3,20 / venda 5,50) e sabão 20 un. (9,90 / 14,90).

let saleCounter = 100;
/** Acrescenta uma venda concluída ao "banco" do mock. */
function addSale(date: string, items: [id: string, quantity: number][]) {
  const lines = items.map(([id, quantity]) => {
    const p = catalog.products.find((product) => product.id === id)!;
    const subtotal = (Number(p.salePrice) * quantity).toFixed(2);
    return {
      product: { id: p.id, sku: p.sku, name: p.name },
      quantity,
      unitPrice: p.salePrice,
      unitCost: p.costPrice,
      subtotal,
    };
  });
  const total = lines
    .reduce((sum, line) => sum + Math.round(Number(line.subtotal) * 100), 0)
    .toString();
  const sale: Sale & { key: string } = {
    id: `venda-${++saleCounter}`,
    key: `chave-${saleCounter}`,
    number: saleCounter,
    seller: { id: 'vendedor-1', name: 'Pessoa VENDEDOR' },
    status: 'CONCLUIDA',
    total: (Number(total) / 100).toFixed(2),
    items: lines,
    createdAt: `${date}T15:00:00.000Z`,
    canceledAt: null,
    canceledBy: null,
    cancelReason: null,
  };
  catalog.sales.push(sale);
}

const tile = (label: string) =>
  screen.findByText(label, { selector: 'dt' }).then((dt) => dt.nextSibling);
const salesTable = () =>
  screen.findByRole('table', { name: 'Faturamento por período' });
/** Última consulta recebida por um relatório (/reports/sales, ...). */
const sent = (path: string) => catalog.reportQueries[path];
const chart = () =>
  screen.findByRole('slider', { name: 'Faturamento por período' });

describe('niceTicks (eixo Y)', () => {
  it.each([
    [1490, [0, 500, 1000, 1500]],
    [100, [0, 50, 100]],
    [3, [0, 1, 2, 3]],
    [0, [0]],
  ])('máximo %i -> %j', (max, ticks) => {
    expect(niceTicks(max)).toEqual(ticks);
  });
});

describe('ReportsPage: período', () => {
  it('abre em "Este mês", até hoje, agrupado por dia, sem sujar a URL', async () => {
    const { router } = renderAs('GERENTE', '/relatorios');
    expect(await tile('Vendas concluídas')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Este mês' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('De')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('Até (inclusive)')).toHaveValue('2026-11-20');
    expect(sent('/reports/sales').get('from')).toBe('2026-11-01');
    expect(sent('/reports/sales').get('to')).toBe('2026-11-20');
    expect(sent('/reports/sales').get('groupBy')).toBe('day');
    expect(router.state.location.search).toBe('');
  });

  it('atalho "Últimos 7 dias" muda a URL e a consulta', async () => {
    const { router } = renderAs('ADMIN', '/relatorios');
    const user = userEvent.setup();
    await tile('Vendas concluídas');
    await user.click(screen.getByRole('button', { name: 'Últimos 7 dias' }));

    expect(
      Object.fromEntries(new URLSearchParams(router.state.location.search)),
    ).toEqual({ de: '2026-11-14', ate: '2026-11-20' });
    // A venda de 12/11 sai do período.
    expect(
      await screen.findByText('Nenhuma venda concluída no período.'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Últimos 7 dias' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    [
      '?de=2026-11-20&ate=2026-11-01',
      'A data inicial não pode ser depois da final.',
    ],
    ['?de=2025-01-01&ate=2026-11-20', 'O período pode ter no máximo 366 dias.'],
  ])(
    'período inválido (%s): avisa e não chama a API',
    async (search, message) => {
      renderAs('GERENTE', `/relatorios${search}`);
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByLabelText('De')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(screen.getByLabelText('De')).toHaveAccessibleDescription(message);
      expect(
        screen.queryByRole('heading', { name: 'Vendas no período' }),
      ).toBeNull();
      // O valor do estoque não depende do período e continua na tela.
      expect(
        await screen.findByRole('table', {
          name: 'Valor do estoque por categoria',
        }),
      ).toBeVisible();
      expect(catalog.reportQueries).toEqual({});
    },
  );

  it('URL editada à mão: data e agrupamento inválidos voltam ao padrão', async () => {
    renderAs('GERENTE', '/relatorios?de=ontem&ate=2026-02-30&agrupar=ano');
    await tile('Vendas concluídas');
    expect(sent('/reports/sales').get('from')).toBe('2026-11-01');
    expect(sent('/reports/sales').get('to')).toBe('2026-11-20');
    expect(sent('/reports/sales').get('groupBy')).toBe('day');
  });

  it('VENDEDOR abrindo /relatorios pelo endereço: 403', async () => {
    renderAs('VENDEDOR', '/relatorios');
    expect(
      await screen.findByRole('heading', { name: 'Sem permissão' }),
    ).toBeVisible();
  });
});

describe('ReportsPage: vendas no período', () => {
  it('cartões, gráfico e tabela com os mesmos números; cancelada fica fora', async () => {
    addSale('2026-11-17', [['prod-cerveja', 3]]); // 16,50
    addSale('2026-11-17', [['prod-sabao', 2]]); // 29,80
    renderAs('GERENTE', '/relatorios');

    expect(await tile('Vendas concluídas')).toHaveTextContent('3');
    expect(await tile('Faturamento')).toHaveTextContent(/R\$\s61,20/);
    expect(await tile('Ticket médio')).toHaveTextContent(/R\$\s20,40/);

    // Uma coluna por dia com venda; o rótulo direto só no maior valor.
    await chart();
    expect(screen.getAllByTestId('coluna')).toHaveLength(2);
    expect(
      screen.getByText(/R\$\s46,30/, { selector: 'text' }),
    ).toBeInTheDocument();

    const rows = within(await salesTable())
      .getAllByRole('row')
      .slice(1);
    expect(rows).toHaveLength(20); // 01/11 a 20/11, dias sem venda zerados
    expect(rows[11]).toHaveTextContent(/12\/11\/2026\s*1\s*R\$\s14,90/);
    expect(rows[15]).toHaveTextContent(/16\/11\/2026\s*0\s*R\$\s0,00/);
    expect(rows[16]).toHaveTextContent(/17\/11\/2026\s*2\s*R\$\s46,30/);
  });

  it('teclado: slider com uma parada de Tab; as setas percorrem os dias', async () => {
    addSale('2026-11-20', [['prod-cerveja', 1]]);
    renderAs('GERENTE', '/relatorios');
    const user = userEvent.setup();
    const slider = await chart();
    // Fora de foco, sem dica.
    expect(screen.queryByTestId('dica')).toBeNull();

    act(() => slider.focus());
    // O leitor de tela lê o aria-valuetext; a dica visual mostra o mesmo.
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/^01\/11\/2026, 0 vendas: R\$\s0,00$/),
    );
    expect(screen.getByTestId('dica')).toHaveTextContent('01/11/2026');
    await user.keyboard('{End}');
    expect(slider).toHaveValue('19'); // índice 0 = 01/11
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/^20\/11\/2026, 1 venda: R\$\s5,50$/),
    );
    await user.keyboard('{Home}{ArrowRight}');
    expect(slider).toHaveValue('1');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(slider).toHaveValue('0');

    act(() => slider.blur());
    expect(screen.queryByTestId('dica')).toBeNull();
  });

  it('agrupar por semana: períodos começam na segunda', async () => {
    addSale('2026-11-17', [['prod-cerveja', 1]]);
    const { router } = renderAs('GERENTE', '/relatorios');
    const user = userEvent.setup();
    await chart();
    await user.selectOptions(
      screen.getByLabelText('Agrupar vendas por'),
      'Semana (começa na segunda)',
    );

    expect(router.state.location.search).toBe('?agrupar=semana');
    const rows = within(await salesTable())
      .getAllByRole('row')
      .slice(1);
    // 01/11/2026 é domingo: a 1ª semana é a de segunda, 26/10.
    expect(
      rows.map((row) => (row as HTMLTableRowElement).cells[0].textContent),
    ).toEqual([
      'Semana de 26/10/2026',
      'Semana de 02/11/2026',
      'Semana de 09/11/2026',
      'Semana de 16/11/2026',
    ]);
    expect(rows[2]).toHaveTextContent(/R\$\s14,90/);
    expect(sent('/reports/sales').get('groupBy')).toBe('week');
    expect(screen.getByText(/podem estar incompletos/)).toBeVisible();
  });

  it('um mês só: sem gráfico de uma coluna, a tabela já vem aberta', async () => {
    renderAs('GERENTE', '/relatorios?agrupar=mes');
    const table = await salesTable();
    expect(within(table).getByText('novembro de 2026')).toBeVisible();
    expect(screen.queryByRole('slider', { name: /Faturamento/ })).toBeNull();
    expect(table.closest('details')).toHaveAttribute('open');
  });

  it('período sem vendas: ticket "-" e avisos no lugar do gráfico', async () => {
    renderAs('GERENTE', '/relatorios?de=2026-10-01&ate=2026-10-31');
    expect(await tile('Vendas concluídas')).toHaveTextContent('0');
    expect(await tile('Ticket médio')).toHaveTextContent('-');
    expect(
      screen.getByText('Nenhuma venda concluída no período.'),
    ).toBeVisible();
    expect(
      await screen.findByText('Nenhum produto vendido no período.'),
    ).toBeVisible();
  });
});

describe('ReportsPage: mais vendidos e valor do estoque', () => {
  it('ranking por quantidade, com a barra proporcional ao primeiro', async () => {
    addSale('2026-11-17', [['prod-cerveja', 4]]);
    renderAs('ADMIN', '/relatorios');
    const table = await screen.findByRole('table', {
      name: /produtos mais vendidos/,
    });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(/Cerveja lata 350 ml.*4.*R\$\s22,00/);
    expect(rows[1]).toHaveTextContent(/Sabão em pó 1 kg.*1.*R\$\s14,90/);
    const [first, second] = within(table).getAllByTestId('barra');
    expect(first.style.width).toBe('100%');
    expect(second.style.width).toBe('25%');
    expect(sent('/reports/top-products').get('limit')).toBe('10');
  });

  it('valor do estoque por categoria, com desativados e linha de total', async () => {
    catalog.products.find((p) => p.id === 'prod-cerveja')!.active = false;
    renderAs('GERENTE', '/relatorios');
    const table = await screen.findByRole('table', {
      name: 'Valor do estoque por categoria',
    });
    const [, bebidas, limpeza, total] = within(table).getAllByRole('row');
    expect(bebidas).toHaveTextContent(
      /Bebidas\s*1\s*1 desativado\s*4\s*R\$\s12,80\s*R\$\s22,00/,
    );
    expect(limpeza).toHaveTextContent(
      /Limpeza\s*1\s*20\s*R\$\s198,00\s*R\$\s298,00/,
    );
    expect(total).toHaveTextContent(
      /Total\s*2\s*24\s*R\$\s210,80\s*R\$\s320,00/,
    );
  });

  it('a página não tem violações de acessibilidade', async () => {
    addSale('2026-11-17', [['prod-cerveja', 1]]);
    const { container } = renderAs('GERENTE', '/relatorios');
    await chart();
    await screen.findByRole('table', {
      name: 'Valor do estoque por categoria',
    });
    await screen.findByRole('table', { name: /produtos mais vendidos/ });
    await expectNoA11yViolations(container);
  });
});
