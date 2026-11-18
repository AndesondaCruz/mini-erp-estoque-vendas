import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

const table = () =>
  screen.findByRole('table', { name: 'Fornecedores cadastrados' });

describe('SuppliersPage', () => {
  it('mostra só os ativos por padrão e troca pelo filtro de situação', async () => {
    const { router } = renderAs('GERENTE', '/fornecedores');
    const user = userEvent.setup();
    expect(
      within(await table()).getByText('Distribuidora Sertão'),
    ).toBeVisible();
    expect(screen.queryByText('Atacado Antigo')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Situação'), 'Inativos');
    expect(await screen.findByText('Atacado Antigo')).toBeVisible();
    expect(screen.queryByText('Distribuidora Sertão')).toBeNull();
    expect(router.state.location.search).toBe('?status=inativos');
    expect(catalog.lastQuery?.get('active')).toBe('false');
  });

  it('reativar não pede confirmação; desativar pede', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAs('ADMIN', '/fornecedores?status=todos');
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'Reativar Atacado Antigo' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Fornecedor "Atacado Antigo" reativado.',
    );
    expect(confirm).not.toHaveBeenCalled();

    await user.click(
      await screen.findByRole('button', {
        name: 'Desativar Distribuidora Sertão',
      }),
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Fornecedor "Distribuidora Sertão" desativado.',
    );
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderAs('ADMIN', '/fornecedores');
    await table();
    await expectNoA11yViolations(container);
  });
});

describe('SupplierFormPage', () => {
  it('cria com campos opcionais vazios enviados como null', async () => {
    const { router } = renderAs('GERENTE', '/fornecedores/novo');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome'), 'Mercadinho Novo');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await screen.findByRole('heading', { name: 'Fornecedores' });
    expect(router.state.location.pathname).toBe('/fornecedores');
    expect(catalog.lastBody).toEqual({
      name: 'Mercadinho Novo',
      document: null,
      phone: null,
      email: null,
    });
  });

  it('edição vem preenchida; apagar um campo envia null (apaga na API)', async () => {
    renderAs('ADMIN', '/fornecedores/sup-sertao/editar');
    const user = userEvent.setup();
    const phone = await screen.findByLabelText('Telefone (opcional)');
    expect(phone).toHaveValue('(84) 3333-4444');
    await user.clear(phone);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await screen.findByRole('heading', { name: 'Fornecedores' });
    expect(catalog.lastBody).toMatchObject({
      name: 'Distribuidora Sertão',
      phone: null,
      email: 'vendas@sertao.com',
    });
  });

  it('e-mail inválido é barrado antes da API', async () => {
    const { container } = renderAs('GERENTE', '/fornecedores/novo');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome'), 'X');
    await user.type(screen.getByLabelText('E-mail (opcional)'), 'nao-e-email');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe um e-mail válido')).toBeVisible();
    expect(catalog.lastBody).toBeNull();
    await expectNoA11yViolations(container);
  });

  it('fornecedor inexistente: mostra o 404', async () => {
    renderAs('ADMIN', '/fornecedores/nao-existe/editar');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fornecedor não encontrado',
    );
  });
});
