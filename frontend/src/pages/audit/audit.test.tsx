import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';
import type { AuditLog } from '../../lib/types';
import {
  AuditChanges,
  diffRows,
  formatAuditValue,
  formatSaleItem,
} from './AuditChanges';

const table = () =>
  screen.findByRole('table', { name: 'Registros de auditoria' });
/**
 * Ação de cada registro, na ordem da tela. Só as linhas de primeiro nível:
 * dentro de cada <details> há outra tabela (antes/depois).
 */
const actionsInOrder = async () =>
  [...(await table()).querySelectorAll(':scope > tbody > tr')]
    .filter((row) => row.children.length > 1) // ignora "Nenhum registro"
    .map((row) => row.children[2].firstChild?.textContent);

describe('AuditPage', () => {
  it('lista do mais recente para o mais antigo', async () => {
    renderAs('ADMIN', '/auditoria');
    expect(await actionsInOrder()).toEqual([
      'Preço alterado',
      'Acesso negado',
      'Usuário alterado',
      'Login recusado',
    ]);
    expect(catalog.lastQuery?.get('order')).toBe('desc');
    expect(screen.getByText('Ninguém (sem login)')).toBeVisible();
  });

  it('filtros de ação e entidade vão para a URL e para a API', async () => {
    const { router } = renderAs('ADMIN', '/auditoria');
    const user = userEvent.setup();
    await table();

    await user.selectOptions(screen.getByLabelText('Ação'), 'Acesso negado');
    await waitFor(async () =>
      expect(await actionsInOrder()).toEqual(['Acesso negado']),
    );
    expect(router.state.location.search).toBe('?acao=ACCESS_DENIED');
    expect(catalog.lastQuery?.get('action')).toBe('ACCESS_DENIED');

    await user.selectOptions(screen.getByLabelText('Ação'), 'Todas');
    await user.selectOptions(screen.getByLabelText('Entidade'), 'Usuário');
    await waitFor(async () =>
      expect(await actionsInOrder()).toEqual(['Usuário alterado']),
    );
    expect(catalog.lastQuery?.get('entity')).toBe('User');
    expect(catalog.lastQuery?.has('action')).toBe(false);
  });

  it('ação inválida digitada na URL é ignorada', async () => {
    renderAs('ADMIN', '/auditoria?acao=INVENTADA&entidade=Category');
    await table();
    expect(catalog.lastQuery?.has('action')).toBe(false);
    expect(catalog.lastQuery?.has('entity')).toBe(false);
  });

  it('período: o dia final entra inteiro (to exclusivo no dia seguinte)', async () => {
    renderAs('ADMIN', '/auditoria?de=2026-11-18&ate=2026-11-19');
    await table();
    expect(catalog.lastQuery?.get('from')).toBe(
      new Date('2026-11-18T00:00:00').toISOString(),
    );
    expect(catalog.lastQuery?.get('to')).toBe(
      new Date('2026-11-20T00:00:00').toISOString(),
    );
  });

  it('clicar no nome filtra por aquele usuário e mostra o chip com o nome', async () => {
    const { router } = renderAs('ADMIN', '/auditoria');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Filtrar pelos registros de Pessoa VENDEDOR',
      }),
    );
    await waitFor(async () =>
      expect(await actionsInOrder()).toEqual(['Acesso negado']),
    );
    expect(router.state.location.search).toBe('?usuario=vendedor-1');
    expect(catalog.lastQuery?.get('userId')).toBe('vendedor-1');
    expect(
      await screen.findByText('Pessoa VENDEDOR (vendedor@loja.com)'),
    ).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Ver de todos os usuários' }),
    );
    await waitFor(async () => expect(await actionsInOrder()).toHaveLength(4));
    expect(router.state.location.search).toBe('');
  });

  it('detalhes mostram antes e depois, com o campo alterado marcado em texto', async () => {
    renderAs('ADMIN', '/auditoria');
    const user = userEvent.setup();
    await user.click(
      await screen.findByText(
        (_, el) =>
          el?.tagName === 'SUMMARY' &&
          (el.textContent ?? '').includes('Preço alterado'),
      ),
    );
    const diff = screen.getAllByRole('table', {
      name: 'Campos do registro antes e depois da ação',
    })[0];
    const rows = within(diff).getAllByRole('row');
    const salePrice = rows.find((r) =>
      r.textContent?.includes('Preço de venda'),
    )!;
    expect(salePrice).toHaveTextContent('alterado');
    expect(salePrice).toHaveTextContent(/R\$\s5,50/);
    expect(salePrice).toHaveTextContent(/R\$\s6,00/);
    const costPrice = rows.find((r) =>
      r.textContent?.includes('Preço de custo'),
    )!;
    expect(costPrice).not.toHaveTextContent('alterado');
  });

  it('não tem violações de acessibilidade, com os detalhes abertos', async () => {
    const { container } = renderAs('ADMIN', '/auditoria');
    await table();
    for (const details of container.querySelectorAll('details')) {
      details.open = true;
    }
    await expectNoA11yViolations(container);
  });
});

describe('formatação dos detalhes', () => {
  it('traduz papel, situação, dinheiro e listas', () => {
    expect(formatAuditValue('role', 'GERENTE')).toBe('Gerente');
    expect(formatAuditValue('requiredRoles', ['ADMIN', 'GERENTE'])).toBe(
      'Administrador, Gerente',
    );
    expect(formatAuditValue('active', false)).toBe('Inativo');
    expect(formatAuditValue('salePrice', '6.00')).toMatch(/R\$\s6,00/);
    expect(formatAuditValue('reason', null)).toBe('-');
    expect(formatAuditValue('quantity', 0)).toBe('0');
  });

  it('só traduz papel em campo de papel', () => {
    expect(formatAuditValue('name', 'ADMIN')).toBe('ADMIN');
  });

  it('estrutura vira JSON, sem "[object Object]"', () => {
    expect(formatAuditValue('items', [{ productId: 'p1', quantity: 2 }])).toBe(
      '[{"productId":"p1","quantity":2}]',
    );
  });

  it('só marca alterado quando existem os dois lados', () => {
    expect(diffRows({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([
      { key: 'a', before: 1, after: 1, changed: false },
      { key: 'b', before: 2, after: 3, changed: true },
    ]);
    expect(diffRows(null, { a: 1 })).toEqual([
      { key: 'a', before: undefined, after: 1, changed: false },
    ]);
  });
});

describe('itens de venda na auditoria', () => {
  const saleLog = (items: unknown[]): AuditLog => ({
    id: 'log-1',
    action: 'SALE_CREATED',
    user: { id: 'u1', name: 'Vitor', email: 'vitor@example.com' },
    entity: 'Sale',
    entityId: 's1',
    before: null,
    after: { number: 440, total: '199.83', items },
    metadata: null,
    ip: null,
    createdAt: '2026-11-21T18:00:00.000Z',
  });

  it('item com nome e SKU (registros novos)', () => {
    expect(
      formatSaleItem({
        productId: '987e7a1f-b871-4e15-9829-b045137a0f2b',
        sku: 'MER-ARROZ-5K',
        name: 'Arroz branco tipo 1 5 kg',
        quantity: 5,
        unitPrice: '28.90',
      }),
    ).toMatch(/^5 × Arroz branco tipo 1 5 kg \(MER-ARROZ-5K\) a R\$\s28,90$/);
  });

  it('registro antigo, sem nome: começo do id, nunca o JSON', () => {
    expect(
      formatSaleItem({
        productId: '987e7a1f-b871-4e15-9829-b045137a0f2b',
        quantity: 2,
        unitPrice: '9.49',
      }),
    ).toMatch(/^2 × produto 987e7a1f a R\$\s9,49$/);
  });

  it('a tabela de detalhes mostra os itens como lista, sem JSON', () => {
    render(
      <AuditChanges
        log={saleLog([
          {
            productId: 'p1',
            sku: 'A-1',
            name: 'Arroz',
            quantity: 5,
            unitPrice: '28.90',
          },
          {
            productId: 'p2',
            sku: 'F-1',
            name: 'Feijão',
            quantity: 4,
            unitPrice: '9.49',
          },
        ])}
      />,
    );

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/^5 × Arroz \(A-1\)/);
    expect(items[1]).toMatch(/^4 × Feijão \(F-1\)/);
    expect(screen.queryByText(/productId/)).not.toBeInTheDocument();
  });

  it('a lista de itens não tem violações de acessibilidade (axe)', async () => {
    const { container } = render(
      <AuditChanges
        log={saleLog([{ productId: 'p1', name: 'Arroz', quantity: 1 }])}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
