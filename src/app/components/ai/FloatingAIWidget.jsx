// Flagship Floating Polaris AI Quantitative Assistant Widget
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAIChat } from '../../hooks/useAI';
import { Sparkles, X, Maximize2, Send, Bot, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ErrorBoundary from '../common/ErrorBoundary';

export function FloatingAIWidget() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const chatMutation = useAIChat();
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const isLoading = chatMutation.isPending;

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isOpen]);

  const handleSend = (e) => {
    e?.preventDefault();
    const query = input.trim();
    if (!query || isLoading) return;

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    chatMutation.mutate(
      { message: query },
      {
        onSuccess: (data) => {
          const aiMsg = {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: data.reply || 'Quantitative synthesis completed.',
          };
          setMessages((prev) => [...prev, aiMsg]);
        },
        onError: () => {
          const errMsg = {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: 'Unable to reach the quantitative intelligence server. Verify API configuration and network connectivity.',
          };
          setMessages((prev) => [...prev, errMsg]);
        },
      }
    );
  };

  const handleQuickPrompt = (prompt) => {
    if (isLoading) return;
    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: prompt };
    setMessages((prev) => [...prev, userMsg]);

    chatMutation.mutate(
      { message: prompt },
      {
        onSuccess: (data) => {
          const aiMsg = {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: data.reply || 'Quantitative analysis completed.',
          };
          setMessages((prev) => [...prev, aiMsg]);
        },
        onError: () => {
          const errMsg = {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: 'Unable to reach the quantitative intelligence server.',
          };
          setMessages((prev) => [...prev, errMsg]);
        },
      }
    );
  };

  return (
    <ErrorBoundary>
      {/* Floating Widget Trigger Badge */}
      {!isOpen && (
        <div
          id="floating-pulse-ai-trigger"
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(true); }}
          className="floating-ai-trigger"
          title="Open Polaris AI Financial Intelligence"
        >
          <div className="floating-ai-orb-wrapper">
            <img
              src="/pulse_ai_core.jpg"
              alt="Polaris AI Intelligence Core"
              className="floating-ai-orb-img"
            />
            <span className="floating-ai-glow-ring" />
          </div>
          <div className="floating-ai-label-pill">
            <Sparkles size={13} color="#60A5FA" />
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em' }}>
              POLARIS AI
            </span>
          </div>
        </div>
      )}

      {/* Expanded Floating Intelligence Drawer */}
      {isOpen && (
        <div className="floating-ai-panel">
          {/* Header */}
          <div className="floating-ai-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img
                src="/pulse_ai_core.jpg"
                alt="Polaris AI Core"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '1.5px solid rgba(59, 130, 246, 0.5)',
                  boxShadow: 'none',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Polaris AI Intelligence
                  </span>
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: 'var(--accent-bright)',
                      fontWeight: 700,
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                    }}
                  >
                    QUANT CORE
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Institutional Equity Synthesizer
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/ai');
                }}
                className="btn-icon"
                title="Expand to Full AI Desk"
                style={{ padding: '6px' }}
              >
                <Maximize2 size={13} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="btn-icon"
                title="Minimize Widget"
                style={{ padding: '6px' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Chat Body */}
          <div className="floating-ai-body">
            {messages.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '12px 4px' }}>
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <img
                    src="/pulse_ai_core.jpg"
                    alt="Core"
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: '50%',
                      margin: '0 auto 10px',
                      boxShadow: 'none',
                      border: '2px solid rgba(59, 130, 246, 0.4)',
                    }}
                  />
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    How can Polaris AI assist your portfolio?
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Ask about NSE / BSE tickers, volatility regimes, or institutional flow.
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Quick Analytical Queries
                  </span>
                  {[
                    'Analyze NIFTY 50 market breadth & regime',
                    'Key institutional triggers for RELIANCE',
                    'High momentum banking stocks today',
                  ].map((p) => (
                    <button
                      key={p}
                      onClick={() => handleQuickPrompt(p)}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                        fontSize: '11.5px',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all var(--transition-fast)',
                      }}
                    >
                      <span>{p}</span>
                      <ArrowRight size={12} color="var(--accent)" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '88%',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
                      color: m.role === 'user' ? '#FFFFFF' : 'var(--text-primary)',
                      border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                      fontSize: '12px',
                      lineHeight: 1.5,
                      boxShadow: 'none',
                    }}
                  >
                    {m.role === 'user' ? (
                      m.content
                    ) : (
                      <div className="markdown-body" style={{ fontSize: '11.5px' }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 4px' }}>
                    <span className="animate-spin" style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%' }} />
                    Synthesizing quantitative insight...
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Footer */}
          <form onSubmit={handleSend} className="floating-ai-footer">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask ticker, sector or macro inquiry..."
              className="input"
              style={{ fontSize: '12px', padding: '8px 10px', flex: 1 }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="btn btn-primary"
              style={{ padding: '8px 12px' }}
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      )}
    </ErrorBoundary>
  );
}

export default FloatingAIWidget;
