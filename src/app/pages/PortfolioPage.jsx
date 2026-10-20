// ROADMAP: Section 5 & 11 — Virtual Paper Trading Portfolio Page
// Institutional Terminal Styling — Exact Market Polaris Design System
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortfolio, useResetPortfolio, useAddFunds } from '../hooks/useTrade';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Coins,
  Zap,
  RefreshCw,
  BarChart3,
  PlusCircle,
  RotateCcw,
} from 'lucide-react';
import { formatIndianNumber } from '../utils/formatters';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { CardSkeleton } from '../components/common/LoadingSkeleton';
import CompanyLogo from '../components/common/CompanyLogo';

export default function PortfolioPage() {
  const navigate = useNavigate();
  const { data: portfolio, isLoading, refetch } = usePortfolio();
  const resetMutation = useResetPortfolio();
  const addFundsMutation = useAddFunds();

  const account = portfolio?.account || {
    cashBalance: 1000000, totalInvested: 0, totalCurrentValue: 0,
    portfolioTotalValue: 1000000, totalPL: 0, totalPLPercent: 0, dayTotalPL: 0,
  };

  const positions = portfolio?.positions || [];
  const isPositiveOverall = account.totalPL >= 0;
  const isPositiveDay = account.dayTotalPL >= 0;

  const totalVal = account.portfolioTotalValue || 1000000;
  const cashPercent = totalVal > 0 ? ((account.cashBalance / totalVal) * 100).toFixed(1) : 100;
  const equityPercent = totalVal > 0 ? (((account.totalCurrentValue || 0) / totalVal) * 100).toFixed(1) : 0;

  return (
    <ErrorBoundary>
      <div className="page-container-wide portfolio-page">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <h1 className="page-title">Portfolio</h1>
              <span className="badge">BASE CAPITAL ₹10,00,000</span>
            </div>
            <p className="page-subtitle">
              Live mark-to-market holdings, asset allocation, and realized/unrealized P&L from simulated trades.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => addFundsMutation.mutate(100000)}
              disabled={addFundsMutation.isPending}
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '12px', gap: '5px' }}
              title="Add ₹1,00,000 to virtual cash balance"
            >
              <PlusCircle size={13} color="var(--positive)" />
              <span>+₹1L Cash</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (window.confirm('Reset virtual portfolio to initial ₹10,00,000 capital and close paper holdings?')) {
                  resetMutation.mutate();
                }
              }}
              disabled={resetMutation.isPending}
              className="btn btn-ghost"
              style={{ padding: '6px 10px', fontSize: '12px', gap: '4px', color: 'var(--text-muted)' }}
              title="Reset portfolio to ₹10,00,000"
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>

            <button className="btn btn-ghost" onClick={() => refetch()} style={{ padding: '6px 10px' }}>
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>

            <button className="btn btn-primary" onClick={() => navigate('/trade')}>
              <Zap size={13} />
              <span>Simulate Order</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Metric Hero Cards */}
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '12px', marginBottom: '20px' }}>
            <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '12px', marginBottom: '20px' }}>
            {/* Total Portfolio Value */}
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Total Portfolio Value</span>
                <BarChart3 size={15} color="var(--accent)" />
              </div>
              <div className="stat-card-value">₹{formatIndianNumber(account.portfolioTotalValue)}</div>
              <div className="stat-card-sub" style={{ color: isPositiveOverall ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                {isPositiveOverall ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                <span>{isPositiveOverall ? '+' : ''}₹{formatIndianNumber(account.totalPL)} ({isPositiveOverall ? '+' : ''}{account.totalPLPercent}%) Total P&L</span>
              </div>
            </div>

            {/* Unrealized P&L */}
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Unrealized P&L</span>
                {isPositiveOverall ? <TrendingUp size={15} color="var(--positive)" /> : <TrendingDown size={15} color="var(--negative)" />}
              </div>
              <div className="stat-card-value" style={{ color: isPositiveOverall ? 'var(--positive)' : 'var(--negative)' }}>
                {isPositiveOverall ? '+' : ''}₹{formatIndianNumber(account.totalPL)}
              </div>
              <div className="stat-card-sub">
                Day Change:{' '}
                <span style={{ color: isPositiveDay ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                  {isPositiveDay ? '+' : ''}₹{formatIndianNumber(account.dayTotalPL)}
                </span>
              </div>
            </div>

            {/* Invested Capital */}
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Invested Capital</span>
                <Coins size={15} color="var(--text-secondary)" />
              </div>
              <div className="stat-card-value">₹{formatIndianNumber(account.totalInvested)}</div>
              <div className="stat-card-sub">
                Current Value: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>₹{formatIndianNumber(account.totalCurrentValue)}</span>
              </div>
            </div>

            {/* Available Cash */}
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Available Cash</span>
                <Wallet size={15} color="var(--accent)" />
              </div>
              <div className="stat-card-value">₹{formatIndianNumber(account.cashBalance)}</div>
              <div className="stat-card-sub">{cashPercent}% of base capital in cash</div>
            </div>
          </div>
        )}

        {/* Asset Allocation Bar */}
        <div className="card card-padded" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>Asset Allocation</span>
            <div style={{ display: 'flex', gap: '16px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: 'var(--accent)' }} />
                Equities ({equityPercent}%)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: 'var(--text-muted)' }} />
                Cash ({cashPercent}%)
              </span>
            </div>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${equityPercent}%`, backgroundColor: 'var(--accent)' }} />
            <div className="progress-bar-fill" style={{ width: `${cashPercent}%`, backgroundColor: 'var(--text-muted)' }} />
          </div>
        </div>

        {/* Holdings Table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
              Open Positions ({positions.length})
            </div>
          </div>

          {positions.length === 0 ? (
            <div className="empty-state">
              <Wallet size={36} className="empty-state-icon" />
              <div className="empty-state-title">No Active Holdings</div>
              <p className="empty-state-description">
                Execute a simulated order in the trading desk to build your virtual equity portfolio.
              </p>
              <button className="btn btn-primary" onClick={() => navigate('/trade')}>
                Go to Trading Desk
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>INSTRUMENT</th>
                    <th style={{ textAlign: 'right' }}>QTY</th>
                    <th style={{ textAlign: 'right' }}>AVG PRICE</th>
                    <th style={{ textAlign: 'right' }}>LTP</th>
                    <th style={{ textAlign: 'right' }}>INVESTED</th>
                    <th style={{ textAlign: 'right' }}>CURRENT VALUE</th>
                    <th style={{ textAlign: 'right' }}>UNREALIZED P&L</th>
                    <th style={{ textAlign: 'center' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => {
                    const isPos = pos.unrealizedPL >= 0;
                    return (
                      <tr
                        key={pos.symbol}
                        onClick={() => navigate(`/stocks/${pos.symbol}`)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <CompanyLogo symbol={pos.symbol} size={32} />
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '13px' }}>{pos.symbol}</div>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{pos.name || 'NSE Equity'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num-tabular" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{pos.quantity}</td>
                        <td className="num-tabular" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>₹{formatIndianNumber(pos.avgPrice)}</td>
                        <td className="num-tabular" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>₹{formatIndianNumber(pos.ltp || pos.avgPrice)}</td>
                        <td className="num-tabular" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>₹{formatIndianNumber(pos.investedValue || pos.avgPrice * pos.quantity)}</td>
                        <td className="num-tabular" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>₹{formatIndianNumber(pos.currentValue || (pos.ltp || pos.avgPrice) * pos.quantity)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 600, color: isPos ? 'var(--positive)' : 'var(--negative)' }}>
                            {isPos ? '+' : ''}₹{formatIndianNumber(pos.unrealizedPL)}
                          </div>
                          <div style={{ fontSize: '10.5px', color: isPos ? 'var(--positive)' : 'var(--negative)' }}>
                            {isPos ? '+' : ''}{pos.unrealizedPLPercent}%
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="chip"
                            onClick={(e) => { e.stopPropagation(); navigate(`/trade?symbol=${encodeURIComponent(pos.symbol)}`); }}
                            style={{ color: 'var(--accent)' }}
                          >
                            Trade
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
