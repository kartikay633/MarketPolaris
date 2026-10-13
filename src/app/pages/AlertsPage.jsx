// ROADMAP: Section 5 & 12 — Price Alerts Management Page
// Institutional Terminal Styling — Exact Market Pulse Design System
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlerts, useCreateAlert, useDeleteAlert } from '../hooks/useAlerts';
import {
  Bell,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  X,
} from 'lucide-react';
import { formatIndianNumber } from '../utils/formatters';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { TableSkeleton } from '../components/common/LoadingSkeleton';
import CompanyLogo from '../components/common/CompanyLogo';

const QUICK_ALERT_SUGGESTIONS = [
  { symbol: 'NSE:RELIANCE', defaultTarget: 3050, condition: 'ABOVE' },
  { symbol: 'NSE:TCS', defaultTarget: 2000, condition: 'BELOW' },
  { symbol: 'NSE:HDFCBANK', defaultTarget: 750, condition: 'ABOVE' },
  { symbol: 'NSE:INFY', defaultTarget: 1100, condition: 'ABOVE' },
];

export default function AlertsPage() {
  const navigate = useNavigate();
  const { data: alerts = [], isLoading } = useAlerts();
  const createMutation = useCreateAlert();
  const deleteMutation = useDeleteAlert();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [symbol, setSymbol] = useState('NSE:RELIANCE');
  const [targetPrice, setTargetPrice] = useState('');
  const [condition, setCondition] = useState('ABOVE');
  const [note, setNote] = useState('');
  const [filterTab, setFilterTab] = useState('ALL');

  const activeAlerts = alerts.filter((a) => a.status === 'ACTIVE');
  const triggeredAlerts = alerts.filter((a) => a.status === 'TRIGGERED');

  const filteredAlerts = alerts.filter((a) => {
    if (filterTab === 'ACTIVE') return a.status === 'ACTIVE';
    if (filterTab === 'TRIGGERED') return a.status === 'TRIGGERED';
    return true;
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!symbol || !targetPrice) return;

    const formattedSym = symbol.trim().toUpperCase().includes(':')
      ? symbol.trim().toUpperCase()
      : `NSE:${symbol.trim().toUpperCase()}`;

    createMutation.mutate(
      { symbol: formattedSym, targetPrice: parseFloat(targetPrice), condition, note },
      { onSuccess: () => { setShowCreateModal(false); setTargetPrice(''); setNote(''); } }
    );
  };

  const handleQuickAdd = (item) => {
    setSymbol(item.symbol);
    setTargetPrice(item.defaultTarget.toString());
    setCondition(item.condition);
    setShowCreateModal(true);
  };

  return (
    <ErrorBoundary>
      <div className="page-container-wide alerts-page">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <h1 className="page-title">Price alerts</h1>
              <span className="badge badge--accent">{activeAlerts.length} ACTIVE</span>
            </div>
            <p className="page-subtitle">
              Automated threshold monitors alerting when Indian equities breach your configured limit prices.
            </p>
          </div>

          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={14} />
            <span>Create Alert</span>
          </button>
        </div>

        {/* Quick Suggestion Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Quick Triggers:
          </span>
          {QUICK_ALERT_SUGGESTIONS.map((item) => (
            <button
              key={item.symbol}
              className="chip"
              onClick={() => handleQuickAdd(item)}
            >
              {item.symbol.replace('NSE:', '')} {item.condition === 'ABOVE' ? '≥' : '≤'} ₹{item.defaultTarget}
            </button>
          ))}
        </div>

        {/* Filter Tabs */}
        <div className="tab-group" style={{ marginBottom: '16px' }}>
          {[
            { id: 'ALL', label: `All (${alerts.length})` },
            { id: 'ACTIVE', label: `Active (${activeAlerts.length})` },
            { id: 'TRIGGERED', label: `Triggered (${triggeredAlerts.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={`tab-pill${filterTab === tab.id ? ' tab-pill--active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Alerts Table */}
        <div className="card terminal-table-scroll" style={{ overflow: 'hidden' }}>
          <div className="table-header terminal-data-row" style={{ gridTemplateColumns: 'minmax(180px, 2fr) minmax(130px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) 100px' }}>
            <span>Instrument</span>
            <span>Trigger Condition</span>
            <span>Target Price</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {isLoading ? (
            <div style={{ padding: '16px' }}><TableSkeleton rows={4} /></div>
          ) : filteredAlerts.length === 0 ? (
            <div className="empty-state">
              <Bell size={32} className="empty-state-icon" />
              <div className="empty-state-title">No Alerts in this view</div>
              <div className="empty-state-description">
                Click "Create Alert" above to configure your first threshold trigger.
              </div>
            </div>
          ) : (
            <div>
              {filteredAlerts.map((alert, idx) => {
                const isAbove = alert.condition === 'ABOVE';
                const isTriggered = alert.status === 'TRIGGERED';
                return (
                  <div
                    key={alert.id}
                    className="table-row terminal-data-row"
                    style={{
                      gridTemplateColumns: 'minmax(180px, 2fr) minmax(130px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) 100px',
                      cursor: 'default',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <CompanyLogo symbol={alert.symbol} size={28} />
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                          {alert.symbol}
                        </span>
                        {alert.note && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {alert.note}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {isAbove ? <TrendingUp size={13} color="var(--positive)" /> : <TrendingDown size={13} color="var(--negative)" />}
                      <span>{isAbove ? 'Crosses Above' : 'Falls Below'}</span>
                    </div>

                    <div className="num-tabular" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      ₹{formatIndianNumber(alert.targetPrice)}
                    </div>

                    <div>
                      <span className={`badge ${isTriggered ? 'badge--positive' : 'badge--accent'}`}>
                        {alert.status}
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <button
                        className="btn-icon"
                        onClick={() => deleteMutation.mutate(alert.id)}
                        style={{ border: 'none', color: 'var(--text-muted)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal: Create Alert */}
        {showCreateModal && (
          <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="price-alert-title">
              <div className="modal-header">
                <h3 className="modal-title" id="price-alert-title">Set Price Trigger</h3>
                <button className="modal-close" onClick={() => setShowCreateModal(false)} aria-label="Close price alert">
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label className="form-label">Instrument Symbol</label>
                  <input className="input" type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
                </div>

                <div>
                  <label className="form-label">Condition</label>
                  <select className="select" value={condition} onChange={(e) => setCondition(e.target.value)}>
                    <option value="ABOVE">Price Rises Above (≥)</option>
                    <option value="BELOW">Price Falls Below (≤)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">Target Price (₹)</label>
                  <input className="input" type="number" step="0.05" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} placeholder="e.g. 2950.00" required />
                </div>

                <div>
                  <label className="form-label">Note (Optional)</label>
                  <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Breakout retest" />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Saving...' : 'Set Alert'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
