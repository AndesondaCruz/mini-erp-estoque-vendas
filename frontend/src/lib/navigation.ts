import type { Role } from './types';

export interface NavItem {
  to: string;
  label: string;
  roles: readonly Role[];
}

const ALL: readonly Role[] = ['ADMIN', 'GERENTE', 'VENDEDOR'];
export const MANAGERS: readonly Role[] = ['ADMIN', 'GERENTE'];

/**
 * Menu e rotas por papel, conforme a matriz de permissões (seção 4 do plano).
 * `as const` guarda cada `to` como tipo literal: SectionPath (abaixo) obriga
 * routes.tsx a ter uma página para cada seção do menu.
 */
export const NAV_ITEMS = [
  { to: '/', label: 'Início', roles: ALL },
  { to: '/produtos', label: 'Produtos', roles: ALL },
  { to: '/categorias', label: 'Categorias', roles: MANAGERS },
  { to: '/fornecedores', label: 'Fornecedores', roles: MANAGERS },
  { to: '/vendas', label: 'Vendas', roles: ALL },
  { to: '/estoque', label: 'Estoque', roles: ['ADMIN', 'GERENTE'] },
  { to: '/relatorios', label: 'Relatórios', roles: ['ADMIN', 'GERENTE'] },
  { to: '/usuarios', label: 'Usuários', roles: ['ADMIN'] },
  { to: '/auditoria', label: 'Auditoria', roles: ['ADMIN'] },
] as const satisfies readonly NavItem[];

/** Caminho de cada seção do menu, exceto o início. */
export type SectionPath = Exclude<(typeof NAV_ITEMS)[number]['to'], '/'>;

export function navItemsFor(role: Role): NavItem[] {
  // Visto como NavItem[]: com `as const`, roles de cada item é uma tupla de
  // literais, e includes() não aceitaria um Role qualquer.
  const items: readonly NavItem[] = NAV_ITEMS;
  return items.filter((item) => item.roles.includes(role));
}
