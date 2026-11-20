import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '../test/axe';
import { renderApp } from '../test/render';

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  // A página de login é carregada sob demanda (divisão por rota): espera o
  // formulário aparecer antes de interagir, mesmo sem digitar nada.
  const submit = await screen.findByRole('button', { name: 'Entrar' });
  if (email) await user.type(screen.getByLabelText('E-mail'), email);
  if (password) await user.type(screen.getByLabelText('Senha'), password);
  await user.click(submit);
}

describe('LoginPage', () => {
  it('valida os campos antes de chamar a API', async () => {
    renderApp('/login');
    await fillAndSubmit('', '');
    expect(await screen.findByText('Informe um e-mail válido')).toBeVisible();
    expect(screen.getByText('Informe a senha')).toBeVisible();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('senha errada: mostra a mensagem da API e o código para o suporte', async () => {
    renderApp('/login');
    await fillAndSubmit('vendedor@loja.com', 'senha-errada');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('E-mail ou senha inválidos');
    expect(alert).toHaveTextContent('req-teste-123');
  });

  it('login certo: entra e mostra o início', async () => {
    renderApp('/login');
    await fillAndSubmit('gerente@loja.com', 'senha-certa');
    expect(
      await screen.findByRole('heading', { name: 'Olá, Pessoa GERENTE' }),
    ).toBeVisible();
    // 1 produto do catálogo de teste está abaixo do mínimo (ver api-mock).
    expect(await screen.findByTestId('alertas-total')).toHaveTextContent('1');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderApp('/login');
    await screen.findByLabelText('E-mail');
    await expectNoA11yViolations(container);
  });
});
