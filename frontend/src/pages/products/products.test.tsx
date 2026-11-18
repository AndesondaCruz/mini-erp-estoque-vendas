import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

const table = () =>
  screen.findByRole('table', { name: 'Produtos cadastrados' });
const headers = async () =>
  within(await table())
    .getAllByRole('columnheader')
    .map((th) => th.textContent?.replace(/[▲▼]/g, '').trim());

describe('ProductsPage', () => {
  it('VENDEDOR: sem coluna de custo, sem botões de cadastro', async () => {
    renderAs('VENDEDOR', '/produtos');
    expect(await headers()).toEqual([
      'SKU',
      'Nome',
      'Categoria',
      'Preço',
      'Estoque',
    ]);
    expect(screen.queryByRole('link', { name: 'Novo produto' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Editar/ })).toBeNull();
    expect(screen.queryByLabelText('Situação')).toBeNull();
  });

  it('GERENTE: vê custo e edita, mas não desativa (só ADMIN)', async () => {
    renderAs('GERENTE', '/produtos');
    expect(await headers()).toContain('Custo');
    const row = within(await table())
      .getByText('Cerveja lata 350 ml')
      .closest('tr')!;
    expect(row).toHaveTextContent('R$ 3,20');
    expect(row).toHaveTextContent('R$ 5,50');
    expect(row).toHaveTextContent('baixo (mín. 10)');
    expect(
      within(row).getByRole('link', { name: 'Editar Cerveja lata 350 ml' }),
    ).toBeVisible();
    expect(within(row).queryByRole('button', { name: /Desativar/ })).toBeNull();
  });

  it('ADMIN desativa um produto depois de confirmar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAs('ADMIN', '/produtos');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Desativar Cerveja lata 350 ml',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Produto "Cerveja lata 350 ml" desativado.',
    );
    // A lista mostra só ativos por padrão: o produto sai da tela.
    expect(await screen.findByText('Sabão em pó 1 kg')).toBeVisible();
    expect(screen.queryByText('Cerveja lata 350 ml')).toBeNull();
  });

  it('busca, filtro e ordenação vão para a URL e para a API', async () => {
    const { router } = renderAs('GERENTE', '/produtos');
    const user = userEvent.setup();
    await table();

    await user.type(screen.getByLabelText('Buscar por nome ou SKU'), 'sab');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Sabão em pó 1 kg')).toBeVisible();
    expect(screen.queryByText('Cerveja lata 350 ml')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Preço/ }));
    await user.click(screen.getByRole('button', { name: /Preço/ }));
    expect(screen.getByRole('columnheader', { name: /Preço/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    const params = new URLSearchParams(router.state.location.search);
    expect(Object.fromEntries(params)).toEqual({
      search: 'sab',
      sort: 'salePrice',
      order: 'desc',
    });
    expect(catalog.lastQuery?.get('sort')).toBe('salePrice');
    expect(catalog.lastQuery?.get('active')).toBe('true');
  });

  it('URL editada à mão: ordenação desconhecida volta ao padrão', async () => {
    renderAs('GERENTE', '/produtos?sort=senha&page=abc');
    await table();
    expect(catalog.lastQuery?.get('sort')).toBe('name');
    expect(catalog.lastQuery?.get('page')).toBe('1');
  });

  it('a lista não tem violações de acessibilidade', async () => {
    const { container } = renderAs('ADMIN', '/produtos');
    await table();
    await expectNoA11yViolations(container);
  });
});

describe('ProductFormPage', () => {
  async function fillNewProduct(prices: {
    cost: string;
    sale: string;
    sku?: string;
  }) {
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('SKU'),
      prices.sku ?? 'agua-500',
    );
    await user.type(screen.getByLabelText('Nome'), 'Água mineral 500 ml');
    await user.selectOptions(screen.getByLabelText('Categoria'), 'Bebidas');
    await user.type(screen.getByLabelText('Preço de custo (R$)'), prices.cost);
    await user.type(screen.getByLabelText('Preço de venda (R$)'), prices.sale);
    await user.clear(screen.getByLabelText('Estoque mínimo'));
    await user.type(screen.getByLabelText('Estoque mínimo'), '12');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
  }

  it('cria um produto convertendo os campos para o formato da API', async () => {
    const { router } = renderAs('GERENTE', '/produtos/novo');
    await fillNewProduct({ cost: '1,10', sale: '2,50' });

    expect(
      await screen.findByRole('heading', { name: 'Produtos' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/produtos');
    expect(catalog.lastBody).toEqual({
      sku: 'AGUA-500',
      name: 'Água mineral 500 ml',
      categoryId: 'cat-bebidas',
      supplierId: null,
      costPrice: '1.10',
      salePrice: '2.50',
      minStock: 12,
    });
  });

  it('valor inválido não chega à API', async () => {
    renderAs('GERENTE', '/produtos/novo');
    await fillNewProduct({ cost: 'dez', sale: '2,50' });
    expect(
      await screen.findByText('Use um valor como 12,50 (até 2 casas decimais)'),
    ).toBeVisible();
    expect(screen.getByLabelText('Preço de custo (R$)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(catalog.lastBody).toBeNull();
  });

  it('erro da API (SKU repetido) aparece no formulário', async () => {
    renderAs('GERENTE', '/produtos/novo');
    await fillNewProduct({ cost: '1', sale: '2', sku: 'cer-350' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'SKU já cadastrado',
    );
    // Continua no formulário, com o que foi digitado, para corrigir.
    expect(screen.getByLabelText('SKU')).toHaveValue('cer-350');
  });

  it('edição vem preenchida e envia o preço com ponto', async () => {
    renderAs('ADMIN', '/produtos/prod-cerveja/editar');
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', {
        name: 'Editar Cerveja lata 350 ml',
      }),
    ).toBeVisible();
    const sale = screen.getByLabelText('Preço de venda (R$)');
    expect(sale).toHaveValue('5,50');
    expect(screen.getByLabelText('Fornecedor (opcional)')).toHaveDisplayValue(
      'Distribuidora Sertão',
    );

    await user.clear(sale);
    await user.type(sale, '5,99');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('heading', { name: 'Produtos' });
    expect(catalog.lastBody).toMatchObject({
      salePrice: '5.99',
      costPrice: '3.20',
      supplierId: 'sup-sertao',
    });
  });

  it('VENDEDOR abrindo /produtos/novo pelo endereço: 403', async () => {
    renderAs('VENDEDOR', '/produtos/novo');
    expect(
      await screen.findByRole('heading', { name: 'Sem permissão' }),
    ).toBeVisible();
  });

  it('o formulário com erros não tem violações de acessibilidade', async () => {
    const { container } = renderAs('ADMIN', '/produtos/novo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Salvar' }));
    await screen.findByText('Escolha a categoria');
    await expectNoA11yViolations(container);
  });
});
