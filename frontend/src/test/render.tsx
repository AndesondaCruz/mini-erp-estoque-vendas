import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../App';
import { createQueryClient } from '../lib/query-client';
import type { Role } from '../lib/types';
import { routes } from '../routes';
import { makeUser, mockState } from './api-mock';

/** Monta o app inteiro (rotas reais) começando em `path`. */
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router };
}

/** Abre o app já logado (cookie de refresh válido) com o papel dado. */
export function renderAs(role: Role, path: string) {
  mockState.session = makeUser(role);
  return renderApp(path);
}
