// ROADMAP: Section 3, 5 & Design Refinement — Institutional Terminal TopBar
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { useMarketOverview } from '../hooks/useMarketData';
import { MarketStatusBadge } from '../components/market/MarketStatusBadge';
import SearchModal from '../components/navigation/SearchModal';
import { Search, Bell, LogOut, ChevronDown, Sun, Moon } from 'lucide-react';
import { toast } from 'sonner';

const readIds = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
const writeIds = (key, ids) => { try { localStorage.setItem(key, JSON.stringify(ids.slice(-200))); } catch { /* storage unavailable */ } };

export function TopBar() {
  const navigate = useNavigate();
  const { user, profile, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { data: overview } = useMarketOverview();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const location = useLocation();

  // Triggered price alerts: a toast the first time each one is seen anywhere in the app, and the
  // bell's dot until the alerts page has been opened since.
  const { data: alerts = [] } = useAlerts();
  const [seen, setSeen] = useState(() => readIds('mp_alerts_seen'));
  const triggered = alerts.filter((a) => a.status === 'TRIGGERED');
  const unseen = triggered.filter((a) => !seen.includes(a.id));
  useEffect(() => {
    const notified = readIds('mp_alerts_notified');
    const fresh = triggered.filter((a) => !notified.includes(a.id));
    for (const a of fresh) {
      toast.info(`Price alert: ${a.symbol.replace(/^NSE:/, '')} ${a.condition === 'ABOVE' ? 'rose above' : 'fell below'} ₹${a.targetPrice.toLocaleString('en-IN')}`);
    }
    if (fresh.length) writeIds('mp_alerts_notified', [...notified, ...fresh.map((a) => a.id)]);
  }, [triggered.map((a) => a.id).join()]);
  useEffect(() => {
    if (location.pathname === '/alerts' && unseen.length) {
      const ids = [...seen, ...unseen.map((a) => a.id)];
      writeIds('mp_alerts_seen', ids);
      setSeen(ids);
    }
  }, [location.pathname, unseen.length]);

  // Detect OS for keyboard shortcut display
  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
  const shortcutKey = isMac ? '⌘K' : 'Ctrl+K';

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const displayName = profile?.displayName || profile?.full_name || user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Guest';
  const email = user?.email || profile?.email || (profile?.isGuest ? 'Guest on this device' : '');

  const handleLogout = async () => {
    await logout();
    toast.info('Signed out of terminal');
    navigate('/login');
  };

  const handleToggleTheme = () => {
    toggleTheme();
    toast.success(`Switched to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`);
  };

  return (
    <>
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <header className="topbar">
        {/* Global Search Bar */}
        <button
          type="button"
          aria-label="Search stocks and indices"
          className="topbar-search"
          onClick={() => setIsSearchOpen(true)}
        >
          <Search size={14} color="var(--text-muted)" />
          <span className="topbar-search-placeholder">Search NSE / BSE</span>
          <span className="topbar-kbd">{shortcutKey}</span>
        </button>

        {/* Right Terminal Controls */}
        <div className="topbar-controls">
          {/* Real-time Market Status */}
          <MarketStatusBadge
            status={overview?.status}
            reason={overview?.statusMessage}
          />

          {/* Theme Toggle Button */}
          <button
            className="topbar-icon-btn"
            aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            onClick={handleToggleTheme}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Price Alerts Notification Button */}
          <button
            className="topbar-icon-btn"
            aria-label="Price Alerts & Triggers"
            title="Price Alerts & Triggers"
            onClick={() => navigate('/alerts')}
          >
            <Bell size={15} />
            {unseen.length > 0 && <span className="topbar-notification-dot" aria-label={`${unseen.length} triggered alert${unseen.length > 1 ? 's' : ''}`} />}
          </button>

          {/* User Profile Menu */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={showProfileMenu}
              className="topbar-profile-trigger"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
            >
              <div className="topbar-avatar">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="topbar-profile-name">{displayName}</span>
              <ChevronDown size={13} color="var(--text-muted)" />
            </button>

            {/* Profile Dropdown */}
            {showProfileMenu && (
              <>
                <div
                  className="dropdown-backdrop"
                  onClick={() => setShowProfileMenu(false)}
                />
                <div className="topbar-dropdown">
                  <div className="dropdown-header">
                    <div className="dropdown-label">Account</div>
                    <div className="dropdown-value">
                      {email}
                    </div>
                  </div>

                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setShowProfileMenu(false);
                      navigate('/settings');
                    }}
                  >
                    Settings & Profile
                  </button>

                  <button
                    className="dropdown-item dropdown-item--danger"
                    onClick={handleLogout}
                  >
                    <LogOut size={13} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

export default TopBar;
