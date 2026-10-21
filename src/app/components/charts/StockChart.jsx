// ROADMAP: Section 5 & 8 — StockChart (TradingView Lightweight Charts v5)
// Institutional Terminal Styling — Exact Market Polaris Design System
import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import { BarChart3, LineChart as LineIcon, Activity, Maximize2 } from 'lucide-react';
import { formatIndianNumber } from '../../utils/formatters';
import { useThemeStore } from '../../stores/themeStore';
import { istCrosshairTime, istTickMark } from './istTime';

const TIMEFRAMES = [
  { id: '1D', label: '1D' },
  { id: '1W', label: '1W' },
  { id: '1M', label: '1M' },
  { id: '6M', label: '6M' },
  { id: '1Y', label: '1Y' },
  { id: '5Y', label: '5Y' },
];

const CHART_TYPES = [
  { id: 'candlestick', label: 'Candles', icon: BarChart3 },
  { id: 'area', label: 'Area', icon: Activity },
  { id: 'line', label: 'Line', icon: LineIcon },
];

export default function StockChart({
  symbol,
  candles = [],
  isLoading = false,
  selectedTimeframe = '1D',
  onTimeframeChange,
  onLoadOlder,
  isLoadingOlder = false,
  historyExhausted = false,
}) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const loadedRef = useRef({ first: null, count: 0, view: null });
  const onLoadOlderRef = useRef(onLoadOlder);
  onLoadOlderRef.current = onLoadOlder;

  const { theme } = useThemeStore();
  const isLight = theme === 'light';

  // Starts in the style chosen under Settings → Default chart style.
  const [chartType, setChartType] = useState(() => {
    try {
      return { Candles: 'candlestick', Area: 'area', Line: 'line' }[localStorage.getItem('mp_default_chart')] || 'candlestick';
    } catch {
      return 'candlestick';
    }
  });
  const [hoverData, setHoverData] = useState(null);

  // Fallback to latest candle if not hovering
  const latestCandle = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    return candles[candles.length - 1];
  }, [candles]);

  const activeCandle = hoverData || latestCandle;

  // Initialize and update chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up previous instance
    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
    }

    const container = chartContainerRef.current;
    const width = container.clientWidth || 800;
    const height = 460;
    const styles = getComputedStyle(document.documentElement);
    const token = (name) => styles.getPropertyValue(name).trim();

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: token('--surface') },
        textColor: token('--text-muted'),
        fontFamily: "'JetBrains Mono', 'Inter', system-ui, -apple-system, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#3B82F6',
          width: 1,
          style: 3,
          labelBackgroundColor: isLight ? '#1E293B' : '#0A0C10',
        },
        horzLine: {
          color: '#3B82F6',
          width: 1,
          style: 3,
          labelBackgroundColor: isLight ? '#1E293B' : '#0A0C10',
        },
      },
      timeScale: {
        borderColor: isLight ? 'rgba(15, 23, 42, 0.10)' : 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: istTickMark,
      },
      localization: { timeFormatter: istCrosshairTime },
      rightPriceScale: {
        borderColor: isLight ? 'rgba(15, 23, 42, 0.10)' : 'rgba(255, 255, 255, 0.08)',
        scaleMargins: {
          top: 0.12,
          bottom: 0.28, // Leave room for volume at bottom
        },
      },
    });

    chartInstanceRef.current = chart;

    // Main price series
    let mainSeries;
    if (chartType === 'candlestick') {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10B981',
        downColor: '#F43F5E',
        borderVisible: false,
        wickUpColor: '#10B981',
        wickDownColor: '#F43F5E',
      });
    } else if (chartType === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        topColor: 'rgba(59, 130, 246, 0.25)',
        bottomColor: 'rgba(59, 130, 246, 0.00)',
        lineColor: '#3B82F6',
        lineWidth: 2,
      });
    } else {
      mainSeries = chart.addSeries(LineSeries, {
        color: '#3B82F6',
        lineWidth: 2,
      });
    }

    mainSeriesRef.current = mainSeries;

    // Volume histogram series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume_scale',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    volumeSeriesRef.current = volumeSeries;
    loadedRef.current = { first: null, count: 0, view: null };

    // Zooming out or scrolling left to the start of the data asks for an older page.
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && range.from < 15) onLoadOlderRef.current?.();
    });

    // Crosshair move subscription for live OHLC inspection
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setHoverData(null);
        return;
      }

      const candleVal = param.seriesData.get(mainSeries);
      const volumeVal = param.seriesData.get(volumeSeries);

      if (candleVal) {
        if (chartType === 'candlestick') {
          setHoverData({
            time: param.time,
            open: candleVal.open,
            high: candleVal.high,
            low: candleVal.low,
            close: candleVal.close,
            volume: volumeVal?.value || 0,
          });
        } else {
          setHoverData({
            time: param.time,
            close: candleVal.value,
            volume: volumeVal?.value || 0,
          });
        }
      }
    });

    // ResizeObserver for responsive width
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const newWidth = entries[0].contentRect.width;
      chart.applyOptions({ width: newWidth });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartInstanceRef.current = null;
    };
  }, [chartType, theme, isLight]);

  // Data updates keep the chart (and its zoom). When older candles are prepended, the visible
  // window shifts by the same number of bars so the view does not jump.
  useEffect(() => {
    const chart = chartInstanceRef.current, mainSeries = mainSeriesRef.current, volumeSeries = volumeSeriesRef.current;
    if (!chart || !mainSeries || !volumeSeries) return;
    const sorted = [...(candles || [])].sort((a, b) => a.time - b.time);
    const prev = loadedRef.current;
    const view = `${symbol}|${selectedTimeframe}|${chartType}`;
    const range = chart.timeScale().getVisibleLogicalRange();
    mainSeries.setData(chartType === 'candlestick' ? sorted : sorted.map((c) => ({ time: c.time, value: c.close })));
    volumeSeries.setData(sorted.map((c) => ({
      time: c.time,
      value: c.volume || 0,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.40)' : 'rgba(244, 63, 94, 0.40)',
    })));
    if (!sorted.length) return;
    const prepended = prev.view === view && prev.first !== null && sorted[0].time < prev.first
      ? sorted.findIndex((c) => c.time === prev.first) : 0;
    if (prev.view !== view || !prev.count) chart.timeScale().fitContent();
    else if (prepended > 0 && range) chart.timeScale().setVisibleLogicalRange({ from: range.from + prepended, to: range.to + prepended });
    loadedRef.current = { first: sorted[0].time, count: sorted.length, view };
  }, [candles, chartType, theme, symbol, selectedTimeframe]);

  const handleFit = () => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.timeScale().fitContent();
    }
  };

  // Format date/time for tooltip
  const formatTime = (timestamp) => {
    if (!timestamp) return '--';
    const d = new Date(timestamp * 1000);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isBullish = activeCandle ? (activeCandle.close >= (activeCandle.open ?? activeCandle.close)) : true;
  const candleChange = activeCandle && activeCandle.open ? (activeCandle.close - activeCandle.open) : 0;
  const candleChangePct = activeCandle && activeCandle.open ? ((candleChange / activeCandle.open) * 100) : 0;

  return (
    <div
      className="card"
      style={{
        backgroundColor: isLight ? '#FFFFFF' : '#05070B',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        boxShadow: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Chart Top Controls Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: isLight ? '#F8FAFC' : 'rgba(10, 12, 16, 0.85)',
          backdropFilter: 'blur(12px)',
          gap: '12px',
        }}
      >
        {/* Timeframe Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'var(--card-hover)', padding: '3px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          {TIMEFRAMES.map((tf) => {
            const isActive = selectedTimeframe === tf.id;
            return (
              <button
                key={tf.id}
                onClick={() => onTimeframeChange && onTimeframeChange(tf.id)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: isActive ? 'var(--accent)' : 'transparent',
                  color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                  boxShadow: 'none',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {tf.label}
              </button>
            );
          })}
        </div>

        {/* Chart Type Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', backgroundColor: 'var(--card-hover)', padding: '3px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            {CHART_TYPES.map((ct) => {
              const Icon = ct.icon;
              const isActive = chartType === ct.id;
              return (
                <button
                  key={ct.id}
                  onClick={() => setChartType(ct.id)}
                  title={ct.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 9px',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    backgroundColor: isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: isActive ? 'var(--accent-bright)' : 'var(--text-secondary)',
                    border: isActive ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <Icon size={13} />
                  <span>{ct.label}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={handleFit}
            title="Reset Zoom / Fit Chart"
            style={{
              padding: '6px 9px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--card-hover)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              transition: 'all var(--transition-fast)',
            }}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* Interactive OHLC Legend Banner */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '16px',
          padding: '8px 16px',
          backgroundColor: 'var(--background)',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '12px',
        }}
      >
        <div style={{ color: 'var(--text-muted)', fontSize: '11.5px', fontFamily: 'var(--font-mono)' }}>
          {activeCandle ? formatTime(activeCandle.time) : '--'}
        </div>

        {activeCandle?.open !== undefined && (
          <div className="chart-ohlc-values" style={{ display: 'flex', gap: '14px', alignItems: 'center', fontFamily: 'var(--font-mono)' }}>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>O: </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>₹{formatIndianNumber(activeCandle.open)}</span>
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>H: </span>
              <span style={{ color: 'var(--positive)', fontWeight: 600 }}>₹{formatIndianNumber(activeCandle.high)}</span>
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>L: </span>
              <span style={{ color: 'var(--negative)', fontWeight: 600 }}>₹{formatIndianNumber(activeCandle.low)}</span>
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>C: </span>
              <span style={{ color: isBullish ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                ₹{formatIndianNumber(activeCandle.close)}
              </span>
            </span>
            <span>
              <span style={{ color: isBullish ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                {candleChange >= 0 ? '+' : ''}{candleChange.toFixed(2)} ({candleChangePct.toFixed(2)}%)
              </span>
            </span>
          </div>
        )}

        {activeCandle?.open === undefined && activeCandle?.close !== undefined && (
          <div style={{ fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Price: </span>
            <span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>₹{formatIndianNumber(activeCandle.close)}</span>
          </div>
        )}

        {activeCandle?.volume !== undefined && (
          <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Vol: </span>
            <span style={{ color: 'var(--text-secondary)' }}>{formatIndianNumber(activeCandle.volume)}</span>
          </div>
        )}
      </div>

      {/* Chart Canvas Area */}
      <div style={{ position: 'relative', width: '100%', minHeight: '460px', backgroundColor: 'var(--surface)' }}>
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              color: 'var(--text-secondary)',
              fontSize: '13px',
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                border: '2.5px solid var(--border-subtle)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span>Fetching live candles...</span>
          </div>
        )}

        {(isLoadingOlder || historyExhausted) && candles.length > 0 && (
          <div className="chart-history-note" role="status">
            {isLoadingOlder ? 'Loading earlier data…' : 'Start of available history'}
          </div>
        )}
        <div ref={chartContainerRef} style={{ width: '100%', height: '460px' }} />
      </div>
    </div>
  );
}
