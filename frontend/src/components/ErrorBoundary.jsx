import React from 'react';

// Top-level crash guard — a render error shows a friendly card instead of a white screen.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-secondary)',
          padding: 20,
        }}
      >
        <div className="card" style={{ maxWidth: 440, width: '100%', textAlign: 'center', padding: '36px 32px' }}>
          <div style={{ fontSize: '2.6667rem', marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 20 }}>
            The page hit an unexpected error while displaying. Your payroll data is safe — nothing was
            changed or lost. Reload the page to keep working.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
