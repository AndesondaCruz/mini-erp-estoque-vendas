import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { navItemsFor } from '../lib/navigation';
import { ROLE_LABELS } from '../lib/types';

export function Layout() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="min-h-screen">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <span className="text-lg font-semibold text-indigo-700">
            Mini-ERP
          </span>
          <div className="flex items-center gap-3 text-sm">
            <span>
              {user.name}{' '}
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {ROLE_LABELS[user.role]}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              Sair
            </button>
          </div>
        </div>
        <nav aria-label="Principal" className="mx-auto max-w-6xl px-4">
          <ul className="flex flex-wrap gap-1">
            {navItemsFor(user.role).map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `block border-b-2 px-3 py-2 text-sm ${
                      isActive
                        ? 'border-indigo-600 font-medium text-indigo-700'
                        : 'border-transparent text-slate-700 hover:text-slate-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="conteudo" className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
