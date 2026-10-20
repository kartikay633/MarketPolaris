// ROADMAP: Section 5 — Empty State & Error Boundary
// Institutional Terminal Styling — Exact Market Polaris Design System
import React from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export function EmptyState({ title = 'No data available', message = 'Check back during market hours or adjust your filters', actionText, onAction }) {
  return (
    <div className="empty-state">
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          margin: '0 auto 14px',
        }}
      >
        <Inbox size={22} />
      </div>
      <h4 className="empty-state-title">{title}</h4>
      <p className="empty-state-description">{message}</p>
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="btn btn-primary"
          style={{ marginTop: '8px' }}
        >
          {actionText}
        </button>
      )}
    </div>
  );
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="card card-padded"
          style={{
            margin: '20px 0',
            backgroundColor: 'var(--negative-muted)',
            borderColor: 'var(--negative-border)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <AlertTriangle size={32} color="var(--negative)" />
          <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Something went wrong</h4>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '420px', margin: 0 }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering this component.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn btn-secondary"
            style={{ marginTop: '6px' }}
          >
            <RefreshCw size={14} />
            <span>Try Again</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
