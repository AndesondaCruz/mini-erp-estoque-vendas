import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role } from './lib/types';
import { makeUser, mockState } from './test/api-mock';
import { expectNoA11yViolations } from './test/axe';
import { renderApp } from './test/render';

/** Simula um cookie de refresh válido: a sessão volta ao abrir o app. */
function signedInAs(role: Role) {
  mockState.session = makeUser(role);
}

const menu = () =>
  within(screen.getByRole('navigation', { name: 'Principal' }))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('rotas e guarda por papel', () => {
  it('sem sessão: rota protegida leva ao login e volta depois de entrar', async () => {
    const { router } = renderApp('/relatorios');
    expect(
      await screen.findByRole('heading', { name: 'Entrar no Mini-ERP' }),
    ).toBeVisible();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-mail'), 'admin@loja.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-certa');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(
      await screen.findByRole('heading', { name: 'Relatórios' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/relatorios');
  });

  it('recarregar a página com cookie válido: a sessão volta sem login', async () => {
    signedInAs('GERENTE');
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Olá, Pessoa GERENTE' }),
    ).toBeVisible();
    expect(mockState.refreshCalls).toBe(1);
  });

  it.each([
    ['VENDEDOR', ['Início', 'Produtos', 'Vendas']],
    [
      'GERENTE',
      [
        'Início',
        'Produtos',
        'Categorias',
        'Fornecedores',
        'Vendas',
        'Estoque',
        'Relatórios',
      ],
    ],
    [
      'ADMIN',
      [
        'Início',
        'Produtos',
        'Categorias',
        'Fornecedores',
        'Vendas',
        'Estoque',
        'Relatórios',
        'Usuários',
        'Auditoria',
      ],
    ],
  ] as const)('menu do %s mostra só o que ele acessa', async (role, items) => {
    signedInAs(role);
    renderApp('/');
    await screen.findByRole('heading', { name: `Olá, Pessoa ${role}` });
    expect(menu()).toEqual(items);
  });

  it('VENDEDOR abrindo /usuarios pelo endereço: página 403', async () => {
    signedInAs('VENDEDOR');
    const { container } = renderApp('/usuarios');
    expect(
      await screen.findByRole('heading', { name: 'Sem permissão' }),
    ).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it.each(['/usuarios/novo', '/auditoria'])(
    'GERENTE abrindo %s pelo endereço: página 403',
    async (path) => {
      signedInAs('GERENTE');
      renderApp(path);
      expect(
        await screen.findByRole('heading', { name: 'Sem permissão' }),
      ).toBeVisible();
    },
  );

  it('sair encerra a sessão e volta para o login', async () => {
    signedInAs('ADMIN');
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(
      await screen.findByRole('heading', { name: 'Entrar no Mini-ERP' }),
    ).toBeVisible();
    expect(mockState.session).toBeNull();
  });

  it('layout autenticado não tem violações de acessibilidade', async () => {
    signedInAs('ADMIN');
    const { container } = renderApp('/');
    await screen.findByTestId('alertas-total');
    await expectNoA11yViolations(container);
  });

  it('endereço inexistente: página 404 acessível', async () => {
    const { container } = renderApp('/nao-existe');
    expect(
      await screen.findByRole('heading', { name: 'Página não encontrada' }),
    ).toBeVisible();
    await expectNoA11yViolations(container);
  });
});
