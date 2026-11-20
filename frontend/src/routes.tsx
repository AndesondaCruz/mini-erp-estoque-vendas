import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { Spinner } from './components/Spinner';
import { MANAGERS, NAV_ITEMS, type SectionPath } from './lib/navigation';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Página carregada sob demanda (divisão do bundle por rota, decisão 88).
 * O import() dinâmico vira um arquivo .js próprio no build, baixado só
 * quando a rota é aberta. Com o `lazy` do React Router, a tela atual fica
 * visível enquanto a próxima carrega, sem um "carregando" a cada clique.
 */
function page<M>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType,
): Pick<RouteObject, 'lazy'> {
  return { lazy: async () => ({ Component: pick(await load()) }) };
}

const pages = {
  login: page(
    () => import('./pages/LoginPage'),
    (m) => m.LoginPage,
  ),
  home: page(
    () => import('./pages/HomePage'),
    (m) => m.HomePage,
  ),
  changePassword: page(
    () => import('./pages/account/ChangePasswordPage'),
    (m) => m.ChangePasswordPage,
  ),
  products: page(
    () => import('./pages/products/ProductsPage'),
    (m) => m.ProductsPage,
  ),
  productForm: page(
    () => import('./pages/products/ProductFormPage'),
    (m) => m.ProductFormPage,
  ),
  categories: page(
    () => import('./pages/categories/CategoriesPage'),
    (m) => m.CategoriesPage,
  ),
  suppliers: page(
    () => import('./pages/suppliers/SuppliersPage'),
    (m) => m.SuppliersPage,
  ),
  supplierForm: page(
    () => import('./pages/suppliers/SupplierFormPage'),
    (m) => m.SupplierFormPage,
  ),
  sales: page(
    () => import('./pages/sales/SalesPage'),
    (m) => m.SalesPage,
  ),
  newSale: page(
    () => import('./pages/sales/NewSalePage'),
    (m) => m.NewSalePage,
  ),
  saleDetail: page(
    () => import('./pages/sales/SaleDetailPage'),
    (m) => m.SaleDetailPage,
  ),
  reports: page(
    () => import('./pages/reports/ReportsPage'),
    (m) => m.ReportsPage,
  ),
  stock: page(
    () => import('./pages/stock/StockPage'),
    (m) => m.StockPage,
  ),
  movementForm: page(
    () => import('./pages/stock/MovementFormPage'),
    (m) => m.MovementFormPage,
  ),
  users: page(
    () => import('./pages/users/UsersPage'),
    (m) => m.UsersPage,
  ),
  userForm: page(
    () => import('./pages/users/UserFormPage'),
    (m) => m.UserFormPage,
  ),
  audit: page(
    () => import('./pages/audit/AuditPage'),
    (m) => m.AuditPage,
  ),
};

/** Rotas de criar/editar: só quem escreve no cadastro (ADMIN e GERENTE). */
const formRoutes = (form: Pick<RouteObject, 'lazy'>): RouteObject => ({
  element: <RequireAuth roles={MANAGERS} />,
  children: [
    { path: 'novo', ...form },
    { path: ':id/editar', ...form },
  ],
});

// Páginas de cada seção do menu. O Record exige uma entrada por SectionPath:
// um item novo no menu sem página aqui não compila.
const SECTION_PAGES: Record<SectionPath, RouteObject[]> = {
  '/produtos': [
    { index: true, ...pages.products },
    formRoutes(pages.productForm),
  ],
  '/categorias': [{ index: true, ...pages.categories }],
  '/fornecedores': [
    { index: true, ...pages.suppliers },
    formRoutes(pages.supplierForm),
  ],
  // Os três papéis vendem. O VENDEDOR só vê as próprias vendas (filtro na
  // API) e o botão de cancelar só aparece para ADMIN e GERENTE.
  '/vendas': [
    { index: true, ...pages.sales },
    { path: 'nova', ...pages.newSale },
    { path: ':id', ...pages.saleDetail },
  ],
  // Só ADMIN e GERENTE (NAV_ITEMS), como na API.
  '/relatorios': [{ index: true, ...pages.reports }],
  // A seção inteira já é só de ADMIN e GERENTE (NAV_ITEMS).
  '/estoque': [
    { index: true, ...pages.stock },
    { path: 'nova', ...pages.movementForm },
  ],
  // Usuários e auditoria: só ADMIN (NAV_ITEMS), como na API.
  '/usuarios': [
    { index: true, ...pages.users },
    { path: 'novo', ...pages.userForm },
    { path: ':id/editar', ...pages.userForm },
  ],
  '/auditoria': [{ index: true, ...pages.audit }],
};

// Cada seção do menu vira uma rota protegida pelos papéis da própria seção.
// No ramo do else, o TypeScript já sabe que item.to é um SectionPath.
const sections: RouteObject[] = NAV_ITEMS.flatMap((item) =>
  item.to === '/'
    ? []
    : [
        {
          path: item.to,
          element: <RequireAuth roles={item.roles} />,
          children: SECTION_PAGES[item.to],
        },
      ],
);

// Enquanto o primeiro arquivo de página baixa, ao abrir o app. Nas
// navegações seguintes, a tela anterior continua visível.
const hydrateFallbackElement = <Spinner label="Carregando" />;

// Layout, guardas e as páginas de 404 e 403 ficam no pacote principal:
// são pequenos e aparecem em qualquer navegação.
export const routes: RouteObject[] = [
  { path: '/login', hydrateFallbackElement, ...pages.login },
  {
    element: <RequireAuth />,
    hydrateFallbackElement,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, ...pages.home },
          // Fora do menu: cada papel troca a própria senha pelo cabeçalho.
          { path: 'minha-senha', ...pages.changePassword },
          ...sections,
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
