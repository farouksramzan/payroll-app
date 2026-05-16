import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Modal from '../components/Modal';

function statusBadge(status, nextDue) {
  if (status === 'submitted' || status === 'dry_run') return <span className="badge badge-success">✓ Submitted</span>;
  if (status === 'failed') return <span className="badge badge-error">✗ Failed</span>;
  if (status === 'processing') return <span className="badge badge-accent">⟳ Processing</span>;

  if (nextDue) {
    const today = new Date();
    const due = new Date(nextDue);
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return <span className="badge badge-error">Overdue</span>;
    if (diffDays <= 3) return <span className="badge badge-warning">Due soon</span>;
  }
  return <span className="badge badge-neutral">Pending</span>;
}

function payrollDueBadge(nextPayrollDate) {
  if (!nextPayrollDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextPayrollDate + 'T00:00:00');
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return <span className="badge badge-error">Payroll Overdue</span>;
  if (diffDays === 0) return <span className="badge badge-warning">Payroll Due Today</span>;
  if (diffDays <= 3) return <span className="badge badge-warning">Payroll Due in {diffDays}d</span>;
  return null;
}

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Dashboard() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const data = await api.getClients();
      setClients(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteClient(deleteTarget.id);
      setClients((c) => c.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(false);
    }
  }

  const submitted = clients.filter((c) => c.lastSubmissionStatus === 'submitted' || c.lastSubmissionStatus === 'dry_run').length;
  const overdue = clients.filter((c) => {
    if (!c.nextDueDate) return false;
    return new Date(c.nextDueDate) < new Date();
  }).length;

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>Client Dashboard</h2>
            <p>Manage payroll tax submissions for all clients</p>
          </div>
          <Link to="/clients/new" className="btn btn-primary">
            + Add Client
          </Link>
        </div>
      </div>

      <div className="page-body">
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total Clients</div>
            <div className="stat-value">{clients.length}</div>
            <div className="stat-sub">Active accounts</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Submitted</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{submitted}</div>
            <div className="stat-sub">This period</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pending</div>
            <div className="stat-value" style={{ color: 'var(--warning)' }}>
              {clients.length - submitted}
            </div>
            <div className="stat-sub">Awaiting submission</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Overdue</div>
            <div className="stat-value" style={{ color: overdue > 0 ? 'var(--error)' : 'var(--text-muted)' }}>
              {overdue}
            </div>
            <div className="stat-sub">Past due date</div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
          </div>
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏢</div>
            <h3>No clients yet</h3>
            <p>Add your first client to start managing their payroll tax submissions.</p>
            <Link to="/clients/new" className="btn btn-primary">Add First Client</Link>
          </div>
        ) : (
          <div className="client-grid">
            {clients.map((client) => (
              <div key={client.id} className="client-card" style={{ cursor: 'default' }}>
                <div className="client-card-header">
                  <div>
                    <div className="client-card-name">{client.businessName}</div>
                    <div className="client-card-ein">EIN: {client.ein}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    {statusBadge(client.lastSubmissionStatus, client.nextDueDate)}
                    {payrollDueBadge(client.nextPayrollDate)}
                  </div>
                </div>

                <div className="client-card-meta">
                  <div className="client-card-meta-row">
                    <span className="client-card-meta-label">Schedule</span>
                    <span className="client-card-meta-value" style={{ textTransform: 'capitalize' }}>
                      {client.depositSchedule}
                    </span>
                  </div>
                  <div className="client-card-meta-row">
                    <span className="client-card-meta-label">Next due</span>
                    <span className="client-card-meta-value">{fmt(client.nextDueDate)}</span>
                  </div>
                  {client.nextPayrollDate && (
                    <div className="client-card-meta-row">
                      <span className="client-card-meta-label">Next payroll</span>
                      <span className="client-card-meta-value" style={{ textTransform: 'capitalize' }}>
                        {fmt(client.nextPayrollDate)}
                        {client.payrollFrequency && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>({client.payrollFrequency})</span>}
                      </span>
                    </div>
                  )}
                  {client.lastSubmissionDate && (
                    <div className="client-card-meta-row">
                      <span className="client-card-meta-label">Last submission</span>
                      <span className="client-card-meta-value">{fmt(client.lastSubmissionDate)}</span>
                    </div>
                  )}
                </div>

                <div className="client-card-actions">
                  <Link to={`/clients/${client.id}/payroll/run`} className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                    Run Payroll
                  </Link>
                  <Link to={`/clients/${client.id}/employees`} className="btn btn-secondary btn-sm">
                    Employees
                  </Link>
                  <Link to={`/clients/${client.id}`} className="btn btn-secondary btn-sm">
                    Details
                  </Link>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setDeleteTarget(client)}
                    title="Delete client"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <Modal
          title="Delete Client"
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? <span className="spinner" /> : 'Delete Client'}
              </button>
            </>
          }
        >
          <p style={{ color: 'var(--text-secondary)' }}>
            Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>{deleteTarget.businessName}</strong>?
            This will permanently remove all submissions and data for this client.
          </p>
        </Modal>
      )}
    </>
  );
}
