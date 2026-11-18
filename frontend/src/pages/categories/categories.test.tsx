import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog } from '../../test/api-mock';
import { expectNoA11yViolations } from '../../test/axe';
import { renderAs } from '../../test/render';

const table = () =>
  screen.findByRole('table', { name: 'Categorias cadastradas' });

describe('CategoriesPage', () => {
  it('cria uma categoria e anuncia o resultado', async () => {
    renderAs('GERENTE', '/categorias');
    const user = userEvent.setup();
    await table();
    await user.type(screen.getByLabelText('Nome'), '  Mercearia  ');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Categoria "Mercearia" criada.',
    );
    expect(catalog.lastBody).toEqual({ name: 'Mercearia' });
    expect(await within(await table()).findByText('Mercearia')).toBeVisible();
    expect(screen.getByLabelText('Nome')).toHaveValue('');
  });

  it('nome repetido: mostra o 409 da API', async () => {
    renderAs('ADMIN', '/categorias');
    const user = userEvent.setup();
    await table();
    await user.type(screen.getByLabelText('Nome'), 'Bebidas');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma categoria com esse nome',
    );
  });

  it('renomear abre o campo na linha, com foco nele', async () => {
    renderAs('GERENTE', '/categorias');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Renomear Limpeza' }),
    );
    const input = screen.getByLabelText('Novo nome para Limpeza');
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, 'Limpeza e higiene');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Categoria renomeada para "Limpeza e higiene".',
    );
    expect(screen.queryByLabelText('Novo nome para Limpeza')).toBeNull();
  });

  it('excluir categoria com produtos: a API recusa e a tela explica', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAs('GERENTE', '/categorias');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Excluir Bebidas' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A categoria tem produtos vinculados e não pode ser excluída',
    );
  });

  it('cancelar a confirmação não chama a API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAs('GERENTE', '/categorias');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Excluir Limpeza' }),
    );
    expect(within(await table()).getByText('Limpeza')).toBeVisible();
    expect(catalog.categories).toHaveLength(2);
  });

  it('VENDEDOR não acessa a tela', async () => {
    renderAs('VENDEDOR', '/categorias');
    expect(
      await screen.findByRole('heading', { name: 'Sem permissão' }),
    ).toBeVisible();
  });

  it('não tem violações de acessibilidade, nem com a edição aberta', async () => {
    const { container } = renderAs('ADMIN', '/categorias');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Renomear Bebidas' }),
    );
    await expectNoA11yViolations(container);
  });
});
