import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ClientForm from './pages/ClientForm';
import ClientDetail from './pages/ClientDetail';
import PayrollEntry from './pages/PayrollEntry';
import SubmissionHistory from './pages/SubmissionHistory';
import Employees from './pages/Employees';
import EmployeeForm from './pages/EmployeeForm';
import Reports from './pages/Reports';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="clients/new" element={<ClientForm />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="clients/:id/edit" element={<ClientForm />} />
          <Route path="clients/:id/payroll/new" element={<PayrollEntry />} />
          <Route path="clients/:id/submissions" element={<SubmissionHistory />} />
          <Route path="clients/:id/employees" element={<Employees />} />
          <Route path="clients/:id/employees/new" element={<EmployeeForm />} />
          <Route path="clients/:id/employees/:empId/edit" element={<EmployeeForm />} />
          <Route path="submissions" element={<SubmissionHistory />} />
          <Route path="reports" element={<Reports />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
