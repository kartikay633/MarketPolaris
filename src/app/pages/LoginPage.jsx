// ROADMAP: Section 5, Phase 1 & Design Refinement — Institutional Terminal Login
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Mail, Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithGoogle, continueAsGuest } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    if (!email || !password) {
      setErrorMessage('Please enter both email and password');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await login(email, password);
      if (res.success) {
        toast.success('Welcome back to Market Polaris');
        navigate('/dashboard');
      } else {
        setErrorMessage(res.error || 'Invalid credentials');
        toast.error(res.error || 'Failed to sign in');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGuest = () => {
    continueAsGuest();
    toast.success('Signed in as a guest on this device');
    navigate('/dashboard');
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleSubmitting(true);
      await loginWithGoogle();
    } catch (err) {
      setIsGoogleSubmitting(false);
      toast.error('Google sign-in error: ' + err.message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
          Sign in
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
          Live NSE prices, Polaris AI research and paper trading
        </p>
      </div>

      {errorMessage && (
        <div className="alert-box alert-box--error" style={{ marginBottom: '16px' }}>
          <AlertCircle size={14} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Google Sign-In Button */}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleGoogleSignIn}
        disabled={isGoogleSubmitting}
        style={{ width: '100%', marginBottom: '16px', justifyContent: 'center' }}
      >
        {isGoogleSubmitting ? (
          <>
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <span>Redirecting to Google...</span>
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>Continue with Google</span>
          </>
        )}
      </button>

      {/* Divider */}
      <div className="divider">
        <div className="divider-line" />
        <span className="divider-text">or email</span>
        <div className="divider-line" />
      </div>

      {/* Email & Password Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label className="form-label">Email Address</label>
          <div style={{ position: 'relative' }}>
            <Mail size={15} className="input-icon" />
            <input
              type="email"
              className="input input--with-icon"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trader@domain.com"
              required
            />
          </div>
        </div>

        <div>
          <label className="form-label">Password</label>
          <div style={{ position: 'relative' }}>
            <Lock size={15} className="input-icon" />
            <input
              type="password"
              className="input input--with-icon"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSubmitting}
          style={{ width: '100%', marginTop: '6px' }}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span>Signing in…</span>
            </>
          ) : (
            <>
              <span>Sign in</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      {/* Guest access: no account, data stays on this device */}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleGuest}
        style={{ width: '100%', marginTop: '10px', justifyContent: 'center' }}
      >
        Continue as guest
      </button>
      <p style={{ margin: '4px 0 0', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
        No account needed; your paper portfolio, watchlist and alerts stay on this device.
      </p>

      {/* Switch to Signup */}
      <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '12.5px', color: 'var(--text-muted)' }}>
        New to Market Polaris?{' '}
        <Link to="/signup" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          Create an account
        </Link>
      </div>
    </div>
  );
}
