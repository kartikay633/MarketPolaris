// ROADMAP: Section 5 & Phase 1 — Protected Route Component
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0f',
          color: '#f0f0f5',
          gap: '16px',
        }}
      >
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #1e3a8a, #3366ff)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 24px rgba(51, 102, 255, 0.4)',
            border: '1px solid rgba(51, 102, 255, 0.6)',
          }}
        >
          <Loader2 size={20} color="#fff" className="animate-spin" />
        </div>
        <p style={{ fontSize: '13px', color: '#a0a0b8', letterSpacing: '0.05em' }}>
          LOADING YOUR SESSION…
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
