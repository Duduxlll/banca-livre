import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_TABS } from '../types';
import { useSession } from '../providers/SessionProvider';
import { useToast } from '../providers/ToastProvider';

export function AppLayout(): JSX.Element {
  const { user, logout } = useSession();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const activeTab = ADMIN_TABS.find((tab) => location.pathname.includes(`/${tab.id}`)) || ADMIN_TABS[0];

  async function handleLogout(): Promise<void> {
    try {
      await logout();
      showToast('Sessão encerrada com sucesso.', 'success');
      navigate('/login', { replace: true });
    } catch (error) {
      console.error(error);
      showToast('Não foi possível sair agora.', 'error');
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">B</div>
          <div>
            <strong>Banquinhas</strong>
            <p>Área principal em React + TypeScript</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          {ADMIN_TABS.map((tab) => (
            <NavLink
              key={tab.id}
              to={`/${tab.id}`}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' sidebar-link--active' : ''}`
              }
            >
              <span>{tab.label}</span>
              {!tab.implemented ? <small>Compat</small> : <small>React</small>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span>Logado como</span>
            <strong>{user?.username || 'admin'}</strong>
          </div>
          <a href="/legacy-area" className="btn btn--ghost btn--full">
            Abrir compatibilidade
          </a>
          <button type="button" className="btn btn--danger btn--full" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      <main className="content-area">
        <section className="hero-banner">
          <div>
            <span className="hero-banner__eyebrow">Área administrativa</span>
            <h1>{activeTab.label}</h1>
            <p>
              Essa é a sua interface principal. O backend, autenticação e regras continuam os
              mesmos; onde ainda faltar porte nativo, a compatibilidade roda por trás.
            </p>
          </div>

          <div className="hero-banner__status">
            <span className="status-chip status-chip--accent">
              {activeTab.implemented ? 'React + TypeScript' : 'Compatibilidade interna'}
            </span>
          </div>
        </section>

        <Outlet />
      </main>
    </div>
  );
}
