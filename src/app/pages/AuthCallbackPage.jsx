// ROADMAP: Section 6 & 19 — OAuth Callback Handler Page
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function handleAuthCallback() {
      try {
        // Check for error parameters in URL query
        const searchParams = new URLSearchParams(window.location.search);
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');

        if (error || errorDescription) {
          throw new Error(errorDescription || error || 'Authentication was denied or failed');
        }

        // Check for PKCE auth code in URL
        const code = searchParams.get('code');
        if (code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;

          if (data?.session) {
            useAuthStore.setState({
              user: data.session.user,
              session: data.session,
              isAuthenticated: true,
              isLoading: false,
            });
            await useAuthStore.getState().fetchProfile();
            toast.success('Successfully authenticated with Google');
            navigate('/dashboard', { replace: true });
            return;
          }
        }

        // Fallback: check getSession in case Supabase client already parsed tokens from hash
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (session?.user) {
          useAuthStore.setState({
            user: session.user,
            session,
            isAuthenticated: true,
            isLoading: false,
          });
          await useAuthStore.getState().fetchProfile();
          toast.success('Successfully authenticated with Google');
          navigate('/dashboard', { replace: true });
          return;
        }

        // If no session found yet, wait for onAuthStateChange
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
          if (newSession?.user) {
            useAuthStore.setState({
              user: newSession.user,
              session: newSession,
              isAuthenticated: true,
              isLoading: false,
            });
            await useAuthStore.getState().fetchProfile();
            toast.success('Successfully authenticated with Google');
            subscription.unsubscribe();
            navigate('/dashboard', { replace: true });
          }
        });

        // 5-second timeout safeguard
        setTimeout(() => {
          if (isMounted && !useAuthStore.getState().isAuthenticated) {
            subscription.unsubscribe();
            setErrorMsg('Authentication timed out. Please try logging in again.');
          }
        }, 5000);
      } catch (err) {
        console.error('OAuth Callback Error:', err);
        if (isMounted) {
          setErrorMsg(err.message || 'Failed to complete authentication');
          toast.error(err.message || 'OAuth authentication failed');
        }
      }
    }

    handleAuthCallback();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  if (errorMsg) {
    return (
      <div className="auth-layout">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <AlertCircle size={36} color="var(--negative)" style={{ marginBottom: '16px' }} />
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            Authentication Failed
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 24px', lineHeight: 1.5 }}>
            {errorMsg}
          </p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="btn btn-primary"
            style={{ width: '100%' }}
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-layout" style={{ gap: '16px' }}>
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-elevated)',
        }}
      >
        <Loader2 size={20} color="var(--accent)" className="animate-spin" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em', margin: 0 }}>
          ESTABLISHING SECURE SESSION
        </p>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Verifying Google credentials with Market Polaris terminal...
        </p>
      </div>
    </div>
  );
}
