// ROADMAP: Section 5 & 16 — Intro Page & Router Integration
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@/styles/main.css';

export default function IntroPage() {
  const navigate = useNavigate();
  const [showEnter, setShowEnter] = useState(false);

  useEffect(() => {
    // three.js loads only for the intro, keeping it out of the app's main bundle.
    let exp;
    let cancelled = false;
    import('@/intro/IntroAnimation.js')
      .then(({ startIntroExperience }) => {
        if (!cancelled) exp = startIntroExperience();
      })
      .catch((err) => console.error('Failed to initialize intro animation:', err));

    // Reveal Enter Platform button once brand settles (~5.2s)
    const timer = setTimeout(() => {
      setShowEnter(true);
    }, 5200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (exp && typeof exp.destroy === 'function') {
        exp.destroy();
      }
    };
  }, []);

  const handleEnterPlatform = () => {
    navigate('/login');
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 3D Financial Data Universe WebGL Canvas */}
      <canvas id="webgl-canvas" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}></canvas>

      {/* 2D Logo and Vector Overlay Canvas */}
      <canvas id="intro-canvas" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none' }}></canvas>

      {/* Wordmark overlay */}
      <div id="wordmark" className="wordmark">
        <span className="wordmark-market">MARKET</span>
        <span className="wordmark-pulse">POLARIS</span>
      </div>

      {/* Subtitle */}
      <div id="subtitle" className="subtitle">A GUIDE YOU CAN TRUST IN THE MARKET</div>

      {/* Vignette */}
      <div className="vignette"></div>

      {/* Enter Platform Button */}
      <div
        style={{
          position: 'fixed',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          opacity: showEnter ? 1 : 0,
          pointerEvents: showEnter ? 'auto' : 'none',
          transition: 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <button
          id="enter-platform-btn"
          onClick={handleEnterPlatform}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 28px',
            borderRadius: '9999px',
            background: 'linear-gradient(135deg, rgba(51, 102, 255, 0.2), rgba(39, 200, 255, 0.15))',
            border: '1px solid rgba(51, 102, 255, 0.4)',
            color: '#F0F0F5',
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: '0.875rem',
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            boxShadow: '0 0 24px rgba(51, 102, 255, 0.25)',
            backdropFilter: 'blur(12px)',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.04)';
            e.currentTarget.style.borderColor = 'rgba(39, 200, 255, 0.8)';
            e.currentTarget.style.boxShadow = '0 0 32px rgba(39, 200, 255, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.borderColor = 'rgba(51, 102, 255, 0.4)';
            e.currentTarget.style.boxShadow = '0 0 24px rgba(51, 102, 255, 0.25)';
          }}
        >
          <span>Enter Terminal</span>
          <span style={{ color: '#27C8FF' }}>&rarr;</span>
        </button>
        <span
          style={{
            fontSize: '11px',
            letterSpacing: '0.08em',
            color: 'rgba(232, 236, 241, 0.4)',
            textTransform: 'uppercase',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          Press Space to replay • Click to enter
        </span>
      </div>

      {/* Skip button in top-right corner */}
      <button
        id="skip-intro-btn"
        onClick={handleEnterPlatform}
        style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          zIndex: 20,
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: 'rgba(232, 236, 241, 0.5)',
          padding: '6px 14px',
          borderRadius: '6px',
          fontSize: '12px',
          fontFamily: "'Space Grotesk', sans-serif",
          letterSpacing: '0.05em',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#fff';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'rgba(232, 236, 241, 0.5)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}
      >
        Skip &rarr;
      </button>
    </div>
  );
}
