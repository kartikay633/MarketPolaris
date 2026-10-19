"""How fast do prices absorb NSE filings? Minute-level reactions from the dissemination time.

Run: python -m ml.filing_reaction run --data-dir data/pulse

Research only (no model, no LLM). It tells the filing-reader work which kinds of filings leave a
window after publication, and how long it is.

* Market-hours filings (disseminated 09:15-15:15 IST). The reference price is the close of the
  last complete minute before dissemination. Reactions at +1, +5, +15, +30, +60 minutes and at the
  session close, abnormal versus NIFTY 50 over the same minutes.
* After-hours filings (after 15:30, or before 09:15). The reference is the previous session's
  close; the gap is measured at the next open, then +5, +15, +30 minutes and the close.
* Continuation, the tradable question: after the first k minutes, does the price keep moving
  in the direction of the initial reaction? `cont_k` is the abnormal return from +k to the close,
  signed by the direction of the move up to +k (positive = the move continued). A one-way
  trading cost of about 0.1% is the bar any continuation has to clear.

Filings from January 2022 (start of the 1-minute history) to the latest stored session.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd

from ml.minute_history import load as load_minutes
from ml.news_study import KEYWORDS, load_disclosures
from ml.pulse import atomic_json, utcnow

START = pd.Timestamp("2022-01-01")
HOURS_END = pd.Timedelta(hours=15, minutes=15)
OPEN = pd.Timedelta(hours=9, minutes=15)
CLOSE = pd.Timedelta(hours=15, minutes=30)
MINUTES = [1, 5, 15, 30, 60]
AFTER = [5, 15, 30]


def series(minutes):
    s = minutes.set_index("time").close
    return s[~s.index.duplicated()]


def at(s, t):
    """Close of the minute bar starting at t, or NaN."""
    return s.get(t, np.nan)


def market_hours(ev, px, nifty):
    t0 = ev.ts.floor("min")
    pre = t0 - pd.Timedelta(minutes=1)
    p0, m0 = at(px, pre), at(nifty, pre)
    day = t0.normalize()
    close_t = px.loc[day:day + CLOSE].index.max() if len(px.loc[day:day + CLOSE]) else None
    if not np.isfinite(p0) or not np.isfinite(m0) or close_t is None:
        return None
    out = {}
    for k in MINUTES:
        t = t0 + pd.Timedelta(minutes=k)
        out[f"r{k}"] = (at(px, t) / p0 - 1) - (at(nifty, t) / m0 - 1) if t <= close_t else np.nan
    out["rclose"] = (px[close_t] / p0 - 1) - (at(nifty, close_t) / m0 - 1)
    for k in (5, 15, 30):
        out[f"cont{k}"] = np.sign(out[f"r{k}"]) * (out["rclose"] - out[f"r{k}"]) if np.isfinite(out[f"r{k}"]) else np.nan
    return out


def after_hours(ev, px, nifty, sessions):
    ts = ev.ts
    day = ts.normalize()
    nxt = sessions[sessions > day] if (ts - day) >= CLOSE else sessions[sessions >= day]
    prv = sessions[sessions < nxt[0]] if len(nxt) else []
    if not len(nxt) or not len(prv):
        return None
    d1, d0 = nxt[0], prv[-1]
    prev_close = px.loc[d0:d0 + CLOSE]
    today = px.loc[d1:d1 + CLOSE]
    m_prev, m_today = nifty.loc[d0:d0 + CLOSE], nifty.loc[d1:d1 + CLOSE]
    if prev_close.empty or today.empty or m_prev.empty or m_today.empty:
        return None
    p0, m0 = prev_close.iloc[-1], m_prev.iloc[-1]
    o = d1 + OPEN
    out = {"gap": (at(px, o) / p0 - 1) - (at(nifty, o) / m0 - 1)}
    for k in AFTER:
        t = o + pd.Timedelta(minutes=k)
        out[f"r{k}"] = (at(px, t) / p0 - 1) - (at(nifty, t) / m0 - 1)
    out["rclose"] = (today.iloc[-1] / p0 - 1) - (m_today.iloc[-1] / m0 - 1)
    for k in AFTER:
        out[f"cont{k}"] = np.sign(out[f"r{k}"]) * (out["rclose"] - out[f"r{k}"]) if np.isfinite(out[f"r{k}"]) else np.nan
    return out


def stat(v):
    v = pd.Series(v).dropna()
    n = len(v)
    if n < 3 or v.std() == 0:
        return {"n": n}
    return {"n": n, "meanBps": float(v.mean() * 1e4), "medianBps": float(v.median() * 1e4),
            "t": float(v.mean() / (v.std() / math.sqrt(n))), "positiveShare": float((v > 0).mean())}


def summarise(g, kind):
    cols = (["r1", "r5", "r15", "r30", "r60", "rclose"] if kind == "market" else ["gap", "r5", "r15", "r30", "rclose"])
    out = {"events": int(len(g)), "stocks": int(g.symbol.nunique()),
           "meanAbsMoveBps": {c: float(g[c].abs().mean() * 1e4) for c in cols if c in g},
           "continuation": {c: stat(g[c]) for c in ("cont5", "cont15", "cont30") if c in g}}
    big = g.loc[g.rclose.abs() > .02]
    if len(big) >= 10 and kind == "market":
        # Of the large moves (>2% by the close), how much was already there after k minutes?
        out["shareOfCloseMoveDone"] = {f"+{k}min": float((big[f"r{k}"] / big.rclose).clip(-1, 2).median()) for k in (1, 5, 15, 30, 60)}
    return out


def run(data_dir):
    root = Path(data_dir)
    d = load_disclosures(root)
    d = d.loc[d.ts >= START].copy()
    nifty_min = load_minutes("NIFTY_50")
    nifty = series(nifty_min)
    sessions = pd.DatetimeIndex(sorted(nifty_min.time.dt.normalize().unique()))
    rows = []
    for n, (symbol, g) in enumerate(d.groupby("symbol"), 1):
        m = load_minutes(symbol)
        if m.empty:
            continue
        px = series(m)
        first, last = m.time.min(), m.time.max()
        for ev in g.itertuples():
            if ev.ts < first or ev.ts > last + pd.Timedelta(days=1):
                continue
            tod = ev.ts - ev.ts.normalize()
            kind = "market" if OPEN <= tod <= HOURS_END else ("after" if tod >= CLOSE or tod < OPEN else None)
            if kind is None:
                continue
            r = market_hours(ev, px, nifty) if kind == "market" else after_hours(ev, px, nifty, sessions)
            if r:
                rows.append({"symbol": symbol, "seq": ev.seq, "ts": ev.ts, "category": ev.category, "text": ev.text, "kind": kind, **r})
        if n % 25 == 0:
            print(f"  {n} stocks, {len(rows):,} reactions", flush=True)
    r = pd.DataFrame(rows)
    num = r.select_dtypes("number").columns
    r[num] = r[num].where(r[num].abs() < .5)  # splits and bad prints
    text = (r.category + " " + r.text).str.lower()
    result = {"generatedAt": utcnow(), "status": "research", "source": "NSE dissemination timestamps + Upstox 1-minute candles",
              "period": [r.ts.min().isoformat(), r.ts.max().isoformat()], "reactions": int(len(r)), "groups": {}}
    for kind in ("market", "after"):
        rk = r.loc[r.kind == kind]
        groups = {"all": rk}
        for name, pattern in KEYWORDS.items():
            groups[f"keyword:{name}"] = rk.loc[text.loc[rk.index].str.contains(pattern, regex=True)]
        counts = rk.category.value_counts()
        for cat in counts.index[counts >= 100]:
            groups[f"nse:{cat}"] = rk.loc[rk.category == cat]
        result["groups"][kind] = {k: summarise(g, kind) for k, g in groups.items() if len(g) >= 20}
    atomic_json(root / "reports" / "filing-reaction.json", result)
    r.to_pickle(root / "news-history" / "filing-reactions.pkl")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["run"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    out = run(args.data_dir)
    for kind, groups in out["groups"].items():
        print(f"\n{kind}-hours filings")
        for k, g in sorted(groups.items(), key=lambda x: -x[1]["events"])[:30]:
            c = g["continuation"].get("cont15", {})
            print(f"  {k:<60} n={g['events']:>6} |close|={g['meanAbsMoveBps']['rclose']:6.0f}bps "
                  f"cont15={c.get('meanBps', float('nan')):6.1f}bps t={c.get('t', float('nan')):5.2f}")


if __name__ == "__main__":
    main()
