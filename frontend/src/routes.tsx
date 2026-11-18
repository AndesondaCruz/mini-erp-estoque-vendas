import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { NAV_ITEMS } from './lib/navigation';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Cada seção do menu vira uma rota protegida pelos papéis da própria seção.
const sections: RouteObject[] = NAV_ITEMS.filter((item) => item.to !== '/').map(
  (item) => ({
    element: <RequireAuth roles={item.roles} />,
    children: [
      { path: item.to, element: <ComingSoonPage title={item.label} /> },
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
        children: [{ index: true, element: <HomePage /> }, ...sections],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
