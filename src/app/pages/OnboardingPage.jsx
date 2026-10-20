// ROADMAP: Section 5 & Phase 1 — Onboarding Flow
// Institutional Terminal Styling — Exact Market Polaris Design System
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ArrowRight, TrendingUp, BarChart3, Award, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const EXPERIENCE_LEVELS = [
  {
    id: 'beginner',
    title: 'Beginner',
    desc: 'Exploring Indian equities, NIFTY 50 benchmark metrics, and simulated paper trading.',
    icon: BarChart3,
    badge: 'Standard Starter',
  },
  {
    id: 'intermediate',
    title: 'Intermediate',
    desc: 'Regularly tracking NSE / BSE tickers, candlestick charts, quarterly disclosures, and sector momentum.',
    icon: TrendingUp,
    badge: 'Active Investor',
  },
  {
    id: 'advanced',
    title: 'Advanced / Institutional',
    desc: 'Analyzing market breadth, order flow, valuation metrics, and cross-asset correlation.',
    icon: Award,
    badge: 'Market Veteran',
  },
];

const SECTOR_OPTIONS = [
  'Banking & Financials',
  'Information Technology (IT)',
  'Pharmaceuticals & Healthcare',
  'Automobiles & EV',
  'Energy, Oil & Gas',
  'Fast Moving Consumer Goods (FMCG)',
  'Metals & Mining',
  'Infrastructure & Capital Goods',
  'Real Estate & Construction',
  'Telecom & Media',
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { updateProfile } = useAuthStore();

  const [step, setStep] = useState(1);
  const [experienceLevel, setExperienceLevel] = useState('intermediate');
  const [selectedSectors, setSelectedSectors] = useState(['Banking & Financials', 'Information Technology (IT)']);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleSector = (sector) => {
    if (selectedSectors.includes(sector)) {
      setSelectedSectors(selectedSectors.filter((s) => s !== sector));
    } else {
      setSelectedSectors([...selectedSectors, sector]);
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    try {
      const res = await updateProfile({
        experienceLevel,
        interestedSectors: selectedSectors,
        onboardingCompleted: true,
      });

      if (res.success) {
        toast.success('Market Polaris configured for your terminal');
        navigate('/dashboard');
      } else {
        toast.error('Failed to save preferences');
      }
    } catch (err) {
      toast.error('Error completing setup: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-layout">
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '640px',
          padding: '36px',
          boxShadow: 'none',
        }}
      >
        {/* Step Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <div>
            <span className="badge badge--accent badge--sm" style={{ letterSpacing: '0.05em' }}>
              STEP {step} OF 2
            </span>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '6px', margin: 0 }}>
              {step === 1 ? 'Configure Trading Profile' : 'Select Primary Sectors'}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <div
              style={{
                width: '32px',
                height: '3px',
                borderRadius: '2px',
                backgroundColor: 'var(--accent)',
              }}
            />
            <div
              style={{
                width: '32px',
                height: '3px',
                borderRadius: '2px',
                backgroundColor: step === 2 ? 'var(--accent)' : 'var(--border)',
              }}
            />
          </div>
        </div>

        {/* STEP 1: Experience Level */}
        {step === 1 && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '28px' }}>
              {EXPERIENCE_LEVELS.map((lvl) => {
                const isSelected = experienceLevel === lvl.id;
                const Icon = lvl.icon;
                return (
                  <div
                    key={lvl.id}
                    onClick={() => setExperienceLevel(lvl.id)}
                    className="card"
                    style={{
                      padding: '16px 18px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isSelected ? 'var(--card-hover)' : 'var(--surface)',
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      boxShadow: 'none',
                    }}
                  >
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{lvl.title}</span>
                        <span className="badge badge--sm" style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {lvl.badge}
                        </span>
                      </div>
                      <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        {lvl.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setStep(2)}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
            >
              <span>Continue to Sectors</span>
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* STEP 2: Sectors */}
        {step === 2 && (
          <div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '18px', marginTop: 0 }}>
              Select sectors you wish to track prominently on your terminal dashboard.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))', gap: '8px', marginBottom: '28px' }}>
              {SECTOR_OPTIONS.map((sector) => {
                const isSelected = selectedSectors.includes(sector);
                return (
                  <button
                    key={sector}
                    type="button"
                    onClick={() => toggleSector(sector)}
                    className={`chip ${isSelected ? 'chip--selected' : ''}`}
                    style={{
                      padding: '10px 14px',
                      fontSize: '12px',
                      fontWeight: isSelected ? 600 : 400,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {sector}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn btn-secondary"
                style={{ padding: '11px 20px' }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={isSubmitting}
                className="btn btn-primary"
                style={{ flex: 1, padding: '11px' }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Configuring Terminal...</span>
                  </>
                ) : (
                  <span>Launch Market Polaris Terminal</span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
