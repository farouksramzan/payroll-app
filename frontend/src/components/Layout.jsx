import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import OnboardingModal from './OnboardingModal';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
              background: 'rgba(74,222,128,0.12)',
              border: '1px solid rgba(74,222,128,0.35)',
              borderRadius: 7,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 700,
              color: '#16a34a',
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
