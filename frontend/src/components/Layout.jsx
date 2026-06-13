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
