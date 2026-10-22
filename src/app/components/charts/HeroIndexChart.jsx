// The overview's index chart: hover anywhere for the price and time, scroll or pinch to zoom,
// drag to pan. Earlier sessions load when the view reaches the start of the data.
import React, { useEffect, useRef, useState } from 'react';
import { AreaSeries, ColorType, CrosshairMode, LineStyle, createChart } from 'lightweight-charts';
import { useThemeStore } from '../../stores/themeStore';
import { formatNumber } from '../../utils/formatters';
import { istTickMark } from './istTime';

const istTime = (t, withDay) => new Date(t * 1000).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  ...(withDay ? { day: 'numeric', month: 'short' } : {}),
});

export default function HeroIndexChart({ candles = [], previousClose, isOpen, onLoadOlder, loadingOlder, exhausted }) {
  const boxRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const prevLineRef = useRef(null);
  const loadedRef = useRef({ first: null, count: 0 });
  const olderRef = useRef(onLoadOlder);
  olderRef.current = onLoadOlder;
  const [hover, setHover] = useState(null);
  const { theme } = useThemeStore();

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const css = getComputedStyle(document.documentElement);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const line = token('--fd-trace', '#e8ecf1'), muted = token('--text-dim', '#6b7280');
    const accent = /^#[0-9a-f]{6}$/i.test(token('--accent', '')) ? token('--accent', '') : '#3b82f6';
    const chart = createChart(box, {
      width: box.clientWidth || 800,
      height: box.clientHeight || 236,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted, fontFamily: "'JetBrains Mono', system-ui, sans-serif", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.1 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2, tickMarkFormatter: istTickMark },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: accent },
        horzLine: { color: accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: accent },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      localization: { timeFormatter: (t) => istTime(t, true) },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: line, lineWidth: 2, topColor: `${accent}33`, bottomColor: `${accent}00`,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4, crosshairMarkerBackgroundColor: accent,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    prevLineRef.current = null;
    loadedRef.current = { first: null, count: 0 };
    chart.subscribeCrosshairMove((p) => {
      const point = p?.time ? p.seriesData.get(series) : null;
      setHover(point ? { time: p.time, value: point.value } : null);
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 10) olderRef.current?.(); });
    const resize = new ResizeObserver(([entry]) => {
      if (entry?.contentRect) chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resize.observe(box);
    return () => { resize.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return;
    // The chart library rejects repeated timestamps, so keep one point per time (the last one given).
    const sorted = [...new Map(candles.filter((c) => Number.isFinite(c?.close)).map((c) => [c.time, c])).values()].sort((a, b) => a.time - b.time);
    const range = chart.timeScale().getVisibleLogicalRange();
    const prev = loadedRef.current;
    series.setData(sorted.map((c) => ({ time: c.time, value: c.close })));
    if (!sorted.length) return;
    const prepended = prev.first !== null && sorted[0].time < prev.first ? sorted.findIndex((c) => c.time === prev.first) : 0;
    if (!prev.count) {
      // Open on the latest session; earlier ones are a scroll or zoom away.
      const lastDay = istTime(sorted[sorted.length - 1].time, true).split(',')[0];
      const start = sorted.findIndex((c) => istTime(c.time, true).split(',')[0] === lastDay);
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, start), to: sorted.length + 1 });
    } else if (prepended > 0 && range) {
      chart.timeScale().setVisibleLogicalRange({ from: range.from + prepended, to: range.to + prepended });
    }
    loadedRef.current = { first: sorted[0].time, count: sorted.length };
  }, [candles, theme]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (prevLineRef.current) { series.removePriceLine(prevLineRef.current); prevLineRef.current = null; }
    if (Number.isFinite(previousClose)) {
      prevLineRef.current = series.createPriceLine({ price: previousClose, color: getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim() || '#555', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: 'Prev close' });
    }
  }, [previousClose, theme, candles.length > 0]);

  const last = candles.length ? candles[candles.length - 1] : null;
  const shown = hover || (last && { time: last.time, value: last.close });
  // The previous-close comparison only applies within the latest session.
  const day = (t) => istTime(t, true).split(',')[0];
  const sameSession = shown && last && day(shown.time) === day(last.time);
  const change = sameSession && Number.isFinite(previousClose) ? shown.value - previousClose : null;

  return (
    <div className="fd-hero-chart">
      <div className="fd-hero-chart-readout fd-lbl">
        {shown ? <>
          <span>{hover ? istTime(shown.time, true) : `${isOpen ? 'Now' : 'Last'} · ${istTime(shown.time, true)}`}</span>
          <span className="fd-lbl--accent">{formatNumber(shown.value, 2)}</span>
          {change !== null && <span style={{ color: change >= 0 ? 'var(--positive-text)' : 'var(--negative-text)' }}>{change >= 0 ? '+' : ''}{formatNumber(change, 2)} vs prev close</span>}
        </> : <span>Loading chart…</span>}
        <span className="fd-hero-chart-hint">{loadingOlder ? 'Loading earlier sessions…' : exhausted ? 'Start of available history' : 'Scroll or pinch to zoom · drag to move'}</span>
      </div>
      <div ref={boxRef} className="fd-hero-chart-canvas" aria-label="NIFTY 50 price chart; hover to read prices, scroll or pinch to zoom" role="img" />
    </div>
  );
}
