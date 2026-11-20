import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { MANAGERS, NAV_ITEMS } from './lib/navigation';
import { ChangePasswordPage } from './pages/account/ChangePasswordPage';
import { AuditPage } from './pages/audit/AuditPage';
import { CategoriesPage } from './pages/categories/CategoriesPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductFormPage } from './pages/products/ProductFormPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { NewSalePage } from './pages/sales/NewSalePage';
import { SaleDetailPage } from './pages/sales/SaleDetailPage';
import { SalesPage } from './pages/sales/SalesPage';
import { MovementFormPage } from './pages/stock/MovementFormPage';
import { StockPage } from './pages/stock/StockPage';
import { SupplierFormPage } from './pages/suppliers/SupplierFormPage';
import { SuppliersPage } from './pages/suppliers/SuppliersPage';
import { UserFormPage } from './pages/users/UserFormPage';
import { UsersPage } from './pages/users/UsersPage';

/** Rotas de criar/editar: só quem escreve no cadastro (ADMIN e GERENTE). */
const formRoutes = (form: React.ReactElement): RouteObject => ({
  element: <RequireAuth roles={MANAGERS} />,
  children: [
    { path: 'novo', element: form },
    { path: ':id/editar', element: form },
  ],
});

// Páginas de cada seção do menu. Seção sem entrada aqui mostra "Em breve".
const SECTION_PAGES: Record<string, RouteObject[]> = {
  '/produtos': [
    { index: true, element: <ProductsPage /> },
    formRoutes(<ProductFormPage />),
  ],
  '/categorias': [{ index: true, element: <CategoriesPage /> }],
  '/fornecedores': [
    { index: true, element: <SuppliersPage /> },
    formRoutes(<SupplierFormPage />),
  ],
  // Os três papéis vendem. O VENDEDOR só vê as próprias vendas (filtro na
  // API) e o botão de cancelar só aparece para ADMIN e GERENTE.
  '/vendas': [
    { index: true, element: <SalesPage /> },
    { path: 'nova', element: <NewSalePage /> },
    { path: ':id', element: <SaleDetailPage /> },
  ],
  // Só ADMIN e GERENTE (NAV_ITEMS), como na API.
  '/relatorios': [{ index: true, element: <ReportsPage /> }],
  // A seção inteira já é só de ADMIN e GERENTE (NAV_ITEMS).
  '/estoque': [
    { index: true, element: <StockPage /> },
    { path: 'nova', element: <MovementFormPage /> },
  ],
  // Usuários e auditoria: só ADMIN (NAV_ITEMS), como na API.
  '/usuarios': [
    { index: true, element: <UsersPage /> },
    { path: 'novo', element: <UserFormPage /> },
    { path: ':id/editar', element: <UserFormPage /> },
  ],
  '/auditoria': [{ index: true, element: <AuditPage /> }],
};

// Cada seção do menu vira uma rota protegida pelos papéis da própria seção.
const sections: RouteObject[] = NAV_ITEMS.filter((item) => item.to !== '/').map(
  (item) => ({
    path: item.to,
    element: <RequireAuth roles={item.roles} />,
    children: SECTION_PAGES[item.to] ?? [
      { index: true, element: <ComingSoonPage title={item.label} /> },
    ],
  }),
);

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <HomePage /> },
          // Fora do menu: cada papel troca a própria senha pelo cabeçalho.
          { path: 'minha-senha', element: <ChangePasswordPage /> },
          ...sections,
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
