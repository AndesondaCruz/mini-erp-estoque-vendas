import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { accounts, mockState } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

async function fill(current: string, next: string, confirmation = next) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Senha atual'), current);
  await user.type(screen.getByLabelText('Nova senha'), next);
  await user.type(screen.getByLabelText('Confirme a nova senha'), confirmation);
  await user.click(screen.getByRole('button', { name: 'Trocar senha' }));
}

describe('ChangePasswordPage', () => {
  it.each(['ADMIN', 'GERENTE', 'VENDEDOR'] as const)(
    '%s chega pelo link do cabeçalho',
    async (role) => {
      const { router } = renderAs(role, '/');
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('link', { name: 'Trocar senha' }),
      );
      expect(
        await screen.findByRole('heading', { name: 'Trocar minha senha' }),
      ).toBeVisible();
      expect(router.state.location.pathname).toBe('/minha-senha');
    },
  );

  it('troca, encerra a sessão sem chamar logout e vai ao login com o aviso', async () => {
    const { router } = renderAs('VENDEDOR', '/minha-senha');
    const refreshesBefore = () => mockState.refreshCalls;
    await screen.findByLabelText('Senha atual');
    const before = refreshesBefore();

    await fill('senha-certa', 'uma-frase-nova-longa');

    expect(
      await screen.findByRole('heading', { name: 'Entrar no Mini-ERP' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Senha alterada. Entre de novo com a nova senha.',
    );
    expect(router.state.location.pathname).toBe('/login');
    expect(accounts.passwordBody).toEqual({
      currentPassword: 'senha-certa',
      newPassword: 'uma-frase-nova-longa',
    });
    // Nenhuma tentativa de renovar a sessão encerrada.
    expect(mockState.refreshCalls).toBe(before);

    // Entrar de novo volta para o início, não para a troca de senha.
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-mail'), 'vendedor@loja.com');
    await user.type(screen.getByLabelText('Senha'), 'uma-frase-nova-longa');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('heading', { name: /^Olá/ });
    expect(router.state.location.pathname).toBe('/');
  });

  it('senha atual errada: mostra o erro da API e continua logado', async () => {
    renderAs('GERENTE', '/minha-senha');
    await fill('senha-errada', 'uma-frase-nova-longa');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Senha atual incorreta',
    );
    expect(
      screen.getByRole('heading', { name: 'Trocar minha senha' }),
    ).toBeVisible();
    expect(mockState.session).not.toBeNull();
  });

  it.each([
    [
      'nova curta',
      'senha-certa',
      'curta',
      'curta',
      'Use pelo menos 8 caracteres',
    ],
    [
      'confirmação diferente',
      'senha-certa',
      'uma-frase-nova-longa',
      'outra-frase-longa',
      'A confirmação não é igual à nova senha',
    ],
    [
      'nova igual à atual',
      'senha-certa',
      'senha-certa',
      'senha-certa',
      'A nova senha deve ser diferente da atual',
    ],
  ])(
    '%s é barrada antes da API',
    async (_, current, next, confirm, message) => {
      const { container } = renderAs('ADMIN', '/minha-senha');
      await fill(current, next, confirm);
      expect(await screen.findByText(message)).toBeVisible();
      expect(accounts.passwordBody).toBeNull();
      await expectNoA11yViolations(container);
    },
  );

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderAs('ADMIN', '/minha-senha');
    await screen.findByLabelText('Senha atual');
    await expectNoA11yViolations(container);
  });
});
