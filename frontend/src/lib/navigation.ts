import type { Role } from './types';

export interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

const ALL: Role[] = ['ADMIN', 'GERENTE', 'VENDEDOR'];
export const MANAGERS: Role[] = ['ADMIN', 'GERENTE'];

/**
 * Menu e rotas por papel, conforme a matriz de permissões (seção 4 do plano).
 * As telas de cada seção chegam nas Fases 8 e 9.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', roles: ALL },
  { to: '/produtos', label: 'Produtos', roles: ALL },
  { to: '/categorias', label: 'Categorias', roles: MANAGERS },
  { to: '/fornecedores', label: 'Fornecedores', roles: MANAGERS },
  { to: '/vendas', label: 'Vendas', roles: ALL },
  { to: '/estoque', label: 'Estoque', roles: ['ADMIN', 'GERENTE'] },
  { to: '/relatorios', label: 'Relatórios', roles: ['ADMIN', 'GERENTE'] },
  { to: '/usuarios', label: 'Usuários', roles: ['ADMIN'] },
];

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
