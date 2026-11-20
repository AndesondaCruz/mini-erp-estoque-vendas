import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { accounts, catalog } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

const table = () =>
  screen.findByRole('table', { name: 'Usuários cadastrados' });
const rowOf = async (name: string) =>
  (await within(await table()).findByText(name)).closest('tr')!;

describe('UsersPage', () => {
  it('mostra os ativos por padrão e filtra por papel pela URL', async () => {
    const { router } = renderAs('ADMIN', '/usuarios');
    const user = userEvent.setup();
    expect(within(await table()).getByText('Pessoa GERENTE')).toBeVisible();
    expect(screen.queryByText('Carlos Antigo')).toBeNull();
    expect(catalog.lastQuery?.get('active')).toBe('true');

    await user.selectOptions(screen.getByLabelText('Papel'), 'Gerente');
    await waitFor(() =>
      expect(screen.queryByText('Pessoa VENDEDOR')).toBeNull(),
    );
    expect(router.state.location.search).toBe('?papel=GERENTE');
    expect(catalog.lastQuery?.get('role')).toBe('GERENTE');
    expect(screen.getByText('Pessoa GERENTE')).toBeVisible();
  });

  it('papel inválido digitado na URL é ignorado (não vira 400)', async () => {
    renderAs('ADMIN', '/usuarios?papel=CHEFE');
    await table();
    expect(catalog.lastQuery?.has('role')).toBe(false);
  });

  it('na própria linha não há botão de desativar, e ela é marcada como "você"', async () => {
    renderAs('ADMIN', '/usuarios');
    const mine = await rowOf('Pessoa ADMIN');
    expect(within(mine).getByText('você')).toBeVisible();
    expect(
      within(mine).queryByRole('button', { name: /Desativar/ }),
    ).toBeNull();
    expect(
      within(await rowOf('Pessoa GERENTE')).getByRole('button', {
        name: 'Desativar Pessoa GERENTE',
      }),
    ).toBeVisible();
  });

  it('desativar pede confirmação e manda active: false; reativar não pede', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAs('ADMIN', '/usuarios?status=todos');
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'Desativar Pessoa GERENTE' }),
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Usuário "Pessoa GERENTE" desativado.',
    );
    expect(catalog.lastBody).toEqual({ active: false });

    confirm.mockClear();
    await user.click(
      await screen.findByRole('button', { name: 'Reativar Carlos Antigo' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Usuário "Carlos Antigo" reativado.',
    );
    expect(catalog.lastBody).toEqual({ active: true });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('cancelar a confirmação não chama a API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAs('ADMIN', '/usuarios');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Desativar Pessoa GERENTE' }),
    );
    expect(catalog.lastBody).toBeNull();
    expect(accounts.users.find((u) => u.id === 'gerente-1')?.active).toBe(true);
  });

  it('o link de auditoria leva à auditoria filtrada por aquele usuário', async () => {
    const { router } = renderAs('ADMIN', '/usuarios');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('link', {
        name: 'Ver auditoria de Pessoa VENDEDOR',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Auditoria' }),
    ).toBeVisible();
    expect(router.state.location.search).toBe('?usuario=vendedor-1');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderAs('ADMIN', '/usuarios');
    await table();
    await expectNoA11yViolations(container);
  });
});

describe('UserFormPage', () => {
  it('cria com senha inicial e e-mail normalizado', async () => {
    const { router } = renderAs('ADMIN', '/usuarios/novo');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome'), 'Nova Pessoa');
    await user.type(screen.getByLabelText('E-mail'), '  Nova@Loja.com ');
    await user.type(screen.getByLabelText('Senha inicial'), 'senha-forte-1');
    await user.selectOptions(screen.getByLabelText('Papel'), 'Gerente');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await screen.findByRole('heading', { name: 'Usuários' });
    expect(router.state.location.pathname).toBe('/usuarios');
    expect(catalog.lastBody).toEqual({
      name: 'Nova Pessoa',
      email: 'nova@loja.com',
      password: 'senha-forte-1',
      role: 'GERENTE',
    });
  });

  it('senha curta é barrada antes da API', async () => {
    const { container } = renderAs('ADMIN', '/usuarios/novo');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome'), 'X');
    await user.type(screen.getByLabelText('E-mail'), 'x@loja.com');
    await user.type(screen.getByLabelText('Senha inicial'), 'curta');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      await screen.findByText('Use pelo menos 8 caracteres'),
    ).toBeVisible();
    expect(catalog.lastBody).toBeNull();
    await expectNoA11yViolations(container);
  });

  it('e-mail já cadastrado: mostra o 409 da API', async () => {
    renderAs('ADMIN', '/usuarios/novo');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome'), 'Repetida');
    await user.type(screen.getByLabelText('E-mail'), 'gerente@loja.com');
    await user.type(screen.getByLabelText('Senha inicial'), 'senha-forte-1');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-mail já cadastrado',
    );
  });

  it('edição vem preenchida, sem campo de senha, e não envia senha', async () => {
    renderAs('ADMIN', '/usuarios/vendedor-1/editar');
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Nome');
    expect(name).toHaveValue('Pessoa VENDEDOR');
    expect(screen.queryByLabelText('Senha inicial')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Papel'), 'Gerente');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('heading', { name: 'Usuários' });
    expect(catalog.lastBody).toEqual({
      name: 'Pessoa VENDEDOR',
      email: 'vendedor@loja.com',
      role: 'GERENTE',
    });
  });

  it('na própria conta o papel fica desabilitado e não é enviado', async () => {
    renderAs('ADMIN', '/usuarios/admin-1/editar');
    const user = userEvent.setup();
    const role = await screen.findByLabelText('Papel');
    expect(role).toBeDisabled();
    expect(
      screen.getByText(
        'Você não pode alterar o próprio papel. Outro ADMIN pode.',
      ),
    ).toBeVisible();

    await user.clear(screen.getByLabelText('Nome'));
    await user.type(screen.getByLabelText('Nome'), 'Admin Renomeado');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('heading', { name: 'Usuários' });
    expect(catalog.lastBody).toEqual({
      name: 'Admin Renomeado',
      email: 'admin@loja.com',
    });
  });

  it('usuário inexistente: mostra o 404', async () => {
    renderAs('ADMIN', '/usuarios/nao-existe/editar');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Usuário não encontrado',
    );
  });
});
