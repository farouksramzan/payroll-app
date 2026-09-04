import { useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import OnboardingModal from './OnboardingModal';

// Pathname → tab title. CompanyWorkspace (/clients/:id) sets its own title.
function titleForPath(p) {
  if (p === '/') return 'Companies · PayrollTax Pro';
  if (p === '/clients/new') return 'New Company · PayrollTax Pro';
  if (p.startsWith('/reports')) return 'Reports · PayrollTax Pro';
  if (p.startsWith('/submissions')) return 'Submissions · PayrollTax Pro';
  if (/^\/clients\/[^/]+\/edit$/.test(p)) return 'Edit Company · PayrollTax Pro';
  if (/^\/clients\/[^/]+\/payroll/.test(p)) return 'Payroll · PayrollTax Pro';
  if (/^\/clients\/[^/]+\/submissions/.test(p)) return 'Submissions · PayrollTax Pro';
  if (/^\/clients\/[^/]+\/employees/.test(p)) return 'Employees · PayrollTax Pro';
  if (/^\/clients\/[^/]+\/paystubs/.test(p)) return 'Paystubs · PayrollTax Pro';
  return null;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const title = titleForPath(location.pathname);
    if (title) document.title = title;
  }, [location.pathname]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <OnboardingModal />
      <nav className="top-nav">
        <Link to="/" className="top-nav-logo">
          <span>Payroll</span>Tax Pro
        </Link>
        <div className="top-nav-spacer" />
        <div className="top-nav-user">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('start-tour'))}
            style={{
              background: '#d1fae5',
              border: '1px solid #a7f3d0',
              borderRadius: 7,
              padding: '8px 14px',
              fontSize: '0.8667rem',
              fontWeight: 600,
              color: '#065f46',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            🎓 Tutorial
          </button>
          <span>{user?.username}</span>
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
