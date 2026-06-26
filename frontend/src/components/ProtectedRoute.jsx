import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // If roles are specified and the user's role is not in the allowed list, redirect
  if (roles && !roles.includes(user.role)) {
    if (user.role === 'client')   return <Navigate to={`/company/${user.clientId}`} replace />;
    if (user.role === 'employee') return <Navigate to="/employee" replace />;
    return <Navigate to="/" replace />;
  }

  return children;
}
