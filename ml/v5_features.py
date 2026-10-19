"""pulse-risk-v5 candidate inputs: intraday price action, panic/dip breadth and the option surface.

Definitions and the study protocol are in ml/V5_PROTOCOL.md (committed before any result).
Every value at session t uses only data at or before t's close: the session's own 1-minute
candles and its own end-of-day F&O bhavcopy, both complete before the 18:00 IST cutoff that
the daily candles already use.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from ml.fo_history import read_day, symbol_map
from ml.minute_history import load as load_minutes, minute_dir
from ml.option_features import implied_vol

INTRADAY_METHOD = "intraday-v1"
SURFACE_METHOD = "surface-v1"
MIN_BARS = 300          # a normal session has 375 one-minute bars; shorter special sessions are left out
OPEN_BUCKETS = 6        # first 30 minutes in 5-minute returns
LAST30 = "15:00"
SKEW_POINTS = {"put": np.log(.95), "call": np.log(1.05)}
SKEW_TOLERANCE = .025
MIN_DAYS = 7
CARRY = 3
DOWN_MOVE = -.02

INTRADAY = ["i_rv1", "i_rv5", "i_rv22", "i_down_share5", "i_jump22", "i_open_share5", "i_mdd1", "i_rebound1",
            "i_last30_volume5", "i_vwap_gap1", "i_has"]
PANIC = ["m_breadth_down1", "m_breadth_down5", "m_panic1", "m_rebound1", "m_index_rv5", "m_vix_range1"]
SURFACE = ["s_put_skew", "s_call_skew", "s_pcr_oi", "s_oi_chg5", "s_fut_buildup5", "s_has"]
SUMMARY = ["rv", "down_share", "jump_share", "open_share", "mdd", "rebound", "last30_volume", "vwap_gap", "range"]


def session_summary(day):
    """One session's intraday statistics from its 1-minute bars (time-ordered)."""
    if len(day) < MIN_BARS:
        return None
    t = day.time
    bucket = day.groupby(t.dt.floor("5min")).close.last()
    path = np.log(np.concatenate([[day.open.iloc[0]], bucket.to_numpy()]))
    r = np.diff(path)
    rv2 = float(np.sum(r ** 2))
    if rv2 <= 0:
        return None
    bv = float(np.pi / 2 * np.sum(np.abs(r[1:]) * np.abs(r[:-1])))
    closes = np.log(day.close.to_numpy())
    vol = day.volume.to_numpy(dtype=float)
    typical = (day.high + day.low + day.close).to_numpy() / 3
    late = (t.dt.strftime("%H:%M") >= LAST30).to_numpy()
    return {"rv": np.sqrt(rv2), "down_share": float(np.sum(r[r < 0] ** 2) / rv2),
            "jump_share": max(rv2 - bv, 0.) / rv2, "open_share": float(np.sum(r[:OPEN_BUCKETS] ** 2) / rv2),
            "mdd": float(-np.min(closes - np.maximum.accumulate(closes))),
            "rebound": float(np.log(day.close.iloc[-1] / day.low.min())),
            "last30_volume": float(vol[late].sum() / vol.sum()) if vol.sum() > 0 else np.nan,
            "vwap_gap": float(np.log(day.close.iloc[-1] / (np.sum(typical * vol) / vol.sum()))) if vol.sum() > 0 else np.nan,
            "range": float((day.high.max() - day.low.min()) / day.open.iloc[0]) if day.open.iloc[0] > 0 else np.nan}


def daily_summaries(symbol, data_root):
    """Per-session summary table for one instrument, cached under data/pulse/intraday/."""
    cache = Path(data_root) / "intraday" / f"{INTRADAY_METHOD}-{symbol}.csv.gz"
    files = list((minute_dir() / symbol).glob("*.csv.gz"))
    if not files:
        return pd.DataFrame(columns=["date", *SUMMARY])
    newest = max(f.stat().st_mtime for f in files)
    if cache.exists() and cache.stat().st_mtime >= newest:
        return pd.read_csv(cache, parse_dates=["date"])
    minutes = load_minutes(symbol)
    rows = []
    for date, day in minutes.groupby(minutes.time.dt.normalize()):
        s = session_summary(day.reset_index(drop=True))
        if s:
            rows.append({"date": date, **s})
    out = pd.DataFrame(rows, columns=["date", *SUMMARY])
    cache.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(cache, index=False, date_format="%Y-%m-%d")
    return out


def intraday_wide(data_root, symbols, cal):
    tables = {s: daily_summaries(s, data_root) for s in symbols}
    return {k: pd.DataFrame({s: t.set_index("date")[k] if len(t) else pd.Series(dtype=float) for s, t in tables.items()})
            .reindex(index=cal, columns=symbols) for k in SUMMARY}


def add_intraday_features(long, data_root, cal, stocks, closes, pick, index="NIFTY_50", vix="INDIA_VIX"):
    """i_ (per stock) and m_ (market-wide) inputs on the ml.risk panel; long needs normal_vol."""
    W = intraday_wide(data_root, list(stocks) + [index, vix], cal)
    roll = lambda x, n: x.rolling(n, min_periods=max(1, int(n * .8))).mean()
    s = {k: v[stocks] for k, v in W.items()}
    norm = long.normal_vol.to_numpy()
    lr = lambda wide: np.log(pick(wide) / norm)
    long["i_rv1"], long["i_rv5"], long["i_rv22"] = lr(s["rv"]), lr(roll(s["rv"], 5)), lr(roll(s["rv"], 22))
    long["i_down_share5"] = pick(roll(s["down_share"], 5))
    long["i_jump22"] = pick(roll(s["jump_share"], 22))
    long["i_open_share5"] = pick(roll(s["open_share"], 5))
    long["i_mdd1"] = pick(s["mdd"]) / norm
    long["i_rebound1"] = pick(s["rebound"]) / norm
    long["i_last30_volume5"] = pick(roll(s["last30_volume"], 5) - roll(s["last30_volume"], 60))
    long["i_vwap_gap1"] = pick(s["vwap_gap"])
    for k in INTRADAY[:-1]:
        long[k] = long[k].replace([np.inf, -np.inf], np.nan)
    long["i_has"] = long.i_rv1.notna().astype(float)

    r = closes.pct_change(fill_method=None)
    down = (r < DOWN_MOVE).astype(float).where(r.notna())
    breadth = down.mean(axis=1)
    rv_index = W["rv"][index]
    market = {"m_breadth_down1": breadth, "m_breadth_down5": breadth.rolling(5, min_periods=4).mean(),
              "m_index_rv5": np.log(roll(rv_index, 5) / roll(rv_index, 5).rolling(252, min_periods=120).median()),
              "m_vix_range1": W["range"][vix]}
    for k, v in market.items():
        long[k] = v.replace([np.inf, -np.inf], np.nan).reindex(long.date).to_numpy()
    # Cross-sectional medians of the normalised per-stock values (already point-in-time).
    by_date = long.groupby("date")
    long["m_panic1"] = by_date.i_mdd1.transform("median")
    long["m_rebound1"] = by_date.i_rebound1.transform("median")
    return long


def interpolate_iv(k, target):
    """IV at log-moneyness target by linear interpolation between bracketing strikes, else the nearest within tolerance."""
    lo, hi = k.loc[k.m <= target], k.loc[k.m >= target]
    if len(lo) and len(hi):
        a, b = lo.iloc[-1], hi.iloc[0]
        if b.m == a.m:
            return a.iv
        w = (target - a.m) / (b.m - a.m)
        return a.iv * (1 - w) + b.iv * w
    near = (k.m - target).abs()
    return k.iv.iloc[near.argmin()] if len(k) and near.min() <= SKEW_TOLERANCE else np.nan


def surface_day(day, date):
    """Per symbol: OTM skew at the nearest expiry >= MIN_DAYS away, put/call OI and futures OI."""
    fut = day.loc[day.kind == "FUT"].copy()
    fut["F"] = fut.close.where(fut.volume > 0, fut.settle)
    futures_oi = fut.groupby("symbol").oi.sum()
    expiries = (day.loc[day.kind.isin(["CE", "PE"])].assign(days=lambda x: (x.expiry - date).dt.days)
                .loc[lambda x: x.days >= 1].groupby("symbol").expiry.apply(lambda e: sorted(e.unique())[:2]))
    opt = dict(tuple(day.loc[day.kind.isin(["CE", "PE"])].groupby("symbol")))
    futs = dict(tuple(fut.groupby("symbol")))
    rows = []
    for symbol, near_two in expiries.items():
        o = opt[symbol].loc[lambda x: x.expiry.isin(near_two)]
        oi_put, oi_call = o.loc[o.kind == "PE", "oi"].sum(), o.loc[o.kind == "CE", "oi"].sum()
        row = {"symbol": symbol, "pcr_oi": np.log(oi_put / oi_call) if oi_put > 0 and oi_call > 0 else np.nan,
               "option_oi": float(o.oi.sum()), "futures_oi": float(futures_oi.get(symbol, np.nan)),
               "put_skew": np.nan, "call_skew": np.nan}
        f = futs.get(symbol, fut.iloc[:0])
        usable = [e for e in near_two if (e - date).days >= MIN_DAYS]
        if usable:
            e = usable[0]
            F = f.loc[f.expiry == e, "F"]
            q = o.loc[(o.expiry == e) & (o.volume > 0) & (o.close > 0)]
            if len(F) and F.iloc[0] > 0 and len(q):
                F = float(F.iloc[0])
                q = q.assign(m=np.log(q.strike / F))
                # Out-of-the-money side only: puts below the forward, calls above (at-the-money: both).
                q = q.loc[((q.kind == "PE") & (q.m <= .01)) | ((q.kind == "CE") & (q.m >= -.01))]
                q = q.assign(iv=implied_vol(q.close, F, q.strike, (e - date).days / 365, q.kind == "CE")).dropna(subset=["iv"])
                k = q.groupby("m", as_index=False).iv.mean().sort_values("m")
                atm = interpolate_iv(k, 0.)
                if np.isfinite(atm):
                    row["put_skew"] = interpolate_iv(k, SKEW_POINTS["put"]) - atm
                    row["call_skew"] = interpolate_iv(k, SKEW_POINTS["call"]) - atm
        rows.append(row)
    return pd.DataFrame(rows)


def surface_table(root, universe):
    root = Path(root)
    cache = root / "fo-history" / f"{SURFACE_METHOD}.csv.gz"
    done = pd.read_csv(cache, parse_dates=["date"]) if cache.exists() else pd.DataFrame()
    have = set(done.date.dt.date.astype(str)) if len(done) else set()
    mapping = symbol_map(root, set(universe))
    parts = [done] if len(done) else []
    new = 0
    for path in sorted((root / "fo-history" / "days").glob("*.csv.gz")):
        if path.name[:10] in have:
            continue
        date = pd.Timestamp(path.name[:10])
        t = surface_day(read_day(path, mapping, universe), date)
        t.insert(0, "date", date)
        parts.append(t)
        new += 1
        if new % 250 == 0:
            print(f"  option surface: {new} new sessions", flush=True)
    table = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["date", "symbol"])
    table["date"] = pd.to_datetime(table.date).astype("datetime64[ns]")
    if new:
        table.sort_values(["date", "symbol"]).to_csv(cache, index=False, date_format="%Y-%m-%d")
    return table.loc[table.symbol.isin(universe)]


def add_surface_features(long, root, cal, stocks, closes, pick):
    table = surface_table(root, stocks)
    wide = lambda col: table.pivot_table(index="date", columns="symbol", values=col).reindex(index=cal, columns=stocks)
    carry = lambda x: x.ffill(limit=CARRY)
    ret5 = np.log(closes / closes.shift(5))
    option_oi, futures_oi = wide("option_oi"), wide("futures_oi")
    f = {"s_put_skew": carry(wide("put_skew")), "s_call_skew": carry(wide("call_skew")), "s_pcr_oi": carry(wide("pcr_oi")),
         "s_oi_chg5": np.log(option_oi / option_oi.shift(5)),
         "s_fut_buildup5": np.log(futures_oi / futures_oi.shift(5)) * np.sign(ret5)}
    for k, v in f.items():
        long[k] = pick(v.replace([np.inf, -np.inf], np.nan))
    long["s_has"] = long[["s_put_skew", "s_pcr_oi"]].notna().any(axis=1).astype(float)
    return long
