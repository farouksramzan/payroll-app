import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ClientForm from './pages/ClientForm';
import ClientDetail from './pages/ClientDetail';
import CompanyWorkspace from './pages/CompanyWorkspace';
import PayrollEntry from './pages/PayrollEntry';
import SubmissionHistory from './pages/SubmissionHistory';
import Employees from './pages/Employees';
import EmployeeForm from './pages/EmployeeForm';
import Reports from './pages/Reports';
import Paystubs from './pages/Paystubs';
import PaystubEdit from './pages/PaystubEdit';
import EmployeeDetail from './pages/EmployeeDetail';
import PayrollRun from './pages/PayrollRun';
import InviteAccept from './pages/InviteAccept';
import ClientDashboard from './pages/ClientDashboard';
import EmployeeDashboard from './pages/EmployeeDashboard';
import Onboarding from './pages/Onboarding';

// Redirect /client → /company/:id for client users
function ClientRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'client') return <Navigate to={`/company/${user.clientId}`} replace />;
  return <Navigate to="/" replace />;
}

// Route "/" redirects based on role
function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'client')   return <Navigate to={`/company/${user.clientId}`} replace />;
  if (user.role === 'employee') return <Navigate to="/employee" replace />;
  return null; // admin — render Outlet (Layout/Dashboard)
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/invite/:token" element={<InviteAccept />} />

        {/* Onboarding wizard — new self-registered companies */}
        <Route path="/onboarding" element={
          <ProtectedRoute roles={['client']}>
            <Onboarding />
          </ProtectedRoute>
        } />

        {/* Client legacy redirect */}
        <Route path="/client" element={<ClientRedirect />} />

        {/* Client company workspace — full self-service portal (no admin sidebar) */}
        <Route path="/company/:id" element={
          <ProtectedRoute roles={['client', 'admin']}>
            <CompanyWorkspace clientMode />
          </ProtectedRoute>
        } />

        {/* Client add/edit employee — mirrors admin EmployeeForm */}
        <Route path="/company/:id/employees/new" element={
          <ProtectedRoute roles={['client', 'admin']}>
            <EmployeeForm />
          </ProtectedRoute>
        } />
        <Route path="/company/:id/employees/:empId/edit" element={
          <ProtectedRoute roles={['client', 'admin']}>
            <EmployeeForm />
          </ProtectedRoute>
        } />

        {/* Employee portal */}
        <Route path="/employee" element={
          <ProtectedRoute roles={['employee', 'admin']}>
            <EmployeeDashboard />
          </ProtectedRoute>
        } />

        {/* Admin accountant workspace */}
        <Route
          path="/"
          element={
            <ProtectedRoute roles={['admin']}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="clients/new" element={<ClientForm />} />
          <Route path="clients/:id" element={<CompanyWorkspace />} />
          <Route path="clients/:id/edit" element={<ClientForm />} />
          <Route path="clients/:id/payroll/new" element={<PayrollEntry />} />
          <Route path="clients/:id/payroll/run" element={<PayrollRun />} />
          <Route path="clients/:id/submissions" element={<SubmissionHistory />} />
          <Route path="clients/:id/employees" element={<Employees />} />
          <Route path="clients/:id/employees/new" element={<EmployeeForm />} />
          <Route path="clients/:id/employees/:empId" element={<EmployeeDetail />} />
          <Route path="clients/:id/employees/:empId/edit" element={<EmployeeForm />} />
          <Route path="clients/:id/paystubs" element={<Paystubs />} />
          <Route path="clients/:id/paystubs/:stubId/edit" element={<PaystubEdit />} />
          <Route path="submissions" element={<SubmissionHistory />} />
          <Route path="reports" element={<Reports />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
