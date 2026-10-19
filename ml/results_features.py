"""Point-in-time features from reported quarterly results (data/pulse/results-history).

Inputs per stock, from ml.results_history quarters (one consolidated-or-standalone
basis per stock, earliest filing per quarter):

* year-on-year growth of revenue (log), net profit and EPS (symmetric growth, bounded);
* standardised unexpected profit: this quarter's year-on-year profit change minus the
  mean change of the previous four quarters, over the standard deviation of the
  previous eight changes (a surprise proxy without analyst forecasts);
* revenue growth acceleration versus the previous four quarters, net-margin change,
  a loss flag;
* sessions since the results became known, a freshness-weighted surprise and an
  availability flag (rows without known results are imputed by the models).

Point-in-time rule: a quarter is known from the first session whose 18:00 IST cutoff
is at or after the earlier of (a) NSE's dissemination of the XBRL filing and (b) the
first NSE announcement mentioning results disseminated on, or within three days
after, the board-meeting date (the results themselves, released as a PDF before the
XBRL); an announcement that names a period must name this quarter. The
meeting date is the one the filing states, else (older filings) the first results
meeting in NSE's board-meeting history within 75 days after the quarter ended. Year-on-year and trend inputs of a quarter use only quarters known
by then. Results older than 200 calendar days are treated as missing.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

from ml.disclosure_features import known_session

STALE_DAYS = 200
MATCH_DAYS = 3
MEETING_DAYS = 75
RESULTS_TEXT = r"\bresults?\b"
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
PERIOD = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:\d{1,2}(?:st|nd|rd|th)?,?\s*)?(\d{4})")
QUARTER = ["res_rev_yoy", "res_np_yoy", "res_eps_yoy", "res_sue", "res_rev_accel", "res_margin_chg", "res_loss"]
FEATURES = QUARTER + ["res_abs_sue", "res_sess_since", "res_sue_fresh", "res_available"]
# Cross-sectional inputs for the ranking model (its other stock inputs are daily ranks too).
RANKED = ["res_rev_yoy", "res_np_yoy", "res_eps_yoy", "res_sue", "res_rev_accel", "res_margin_chg", "res_sue_fresh"]


def load_quarters(root):
    path = Path(root) / "results-history" / "quarters.csv"
    if not path.exists():
        return pd.DataFrame(columns=["symbol", "periodEnd", "disseminated", "revenue", "profit", "eps", "boardMeeting"])
    d = pd.read_csv(path)
    for k in ("periodEnd", "disseminated", "boardMeeting"):
        d[k] = pd.to_datetime(d[k], errors="coerce")
    return d.dropna(subset=["periodEnd", "disseminated"])


def meeting_dates(quarters, meetings):
    """Board-meeting date per quarter: as the filing states it, else the first results meeting
    from NSE's board-meeting history within 75 days after the quarter ended."""
    out = quarters.boardMeeting.copy()
    if meetings is None or meetings.empty:
        return out
    by_symbol = {s: np.sort(g.meeting.to_numpy()) for s, g in meetings.groupby("symbol")}
    for i, r in quarters.loc[out.isna()].iterrows():
        m = by_symbol.get(r.symbol)
        if m is None:
            continue
        hit = m[(m > np.datetime64(r.periodEnd)) & (m <= np.datetime64(r.periodEnd + pd.Timedelta(days=MEETING_DAYS)))]
        if len(hit):
            out.at[i] = pd.Timestamp(hit[0])
    return out


def known_times(quarters, disclosures=None, timing="announcement", meetings=None):
    """Timestamp from which each quarter's numbers were public (see module docstring)."""
    known = quarters.disseminated.copy()
    if timing == "xbrl" or disclosures is None or disclosures.empty:
        return known
    quarters = quarters.assign(boardMeeting=meeting_dates(quarters, meetings))
    low = (disclosures.category + " " + disclosures.text).str.lower()
    ann = disclosures.loc[low.str.contains(RESULTS_TEXT, regex=True), ["symbol", "ts"]].assign(low=low).sort_values("ts")
    by_symbol = {s: g for s, g in ann.groupby("symbol")}
    for i, r in quarters.iterrows():
        g = by_symbol.get(r.symbol)
        if g is None or pd.isna(r.boardMeeting):
            continue
        lo = max(r.boardMeeting, r.periodEnd + pd.Timedelta(days=1))
        hit = g.loc[(g.ts >= lo) & (g.ts < r.boardMeeting + pd.Timedelta(days=MATCH_DAYS + 1))]
        # An announcement that names a period must name this quarter's end month and year.
        quarter = (MONTHS[r.periodEnd.month - 1], str(r.periodEnd.year))
        hit = [t for t, text in zip(hit.ts, hit["low"]) if not PERIOD.findall(text) or quarter in PERIOD.findall(text)]
        if hit:
            known.at[i] = min(known.at[i], pd.Timestamp(hit[0]))
    return known


def _sym_growth(a, b):
    den = (np.abs(a) + np.abs(b)) / 2
    return np.where(den > 0, (a - b) / np.where(den > 0, den, 1), np.nan)


def quarter_features(g):
    """Per-quarter inputs for one stock; g sorted by periodEnd with a 'known' column.
    Only quarters known by this quarter's known time feed its comparisons."""
    g = g.sort_values("periodEnd").reset_index(drop=True)
    out = []
    ends, known = g.periodEnd.to_numpy(), g.known.to_numpy()
    for i, r in g.iterrows():
        prior = g.loc[(g.index < i) & (known <= known[i])]

        def lag(row_end, years=1):
            target = row_end - pd.DateOffset(years=years)
            m = prior.loc[(prior.periodEnd - target).abs() <= pd.Timedelta(days=5)]
            return m.iloc[-1] if len(m) else None

        p4 = lag(r.periodEnd)
        f = {k: np.nan for k in QUARTER}
        f["res_loss"] = float(r.profit < 0) if pd.notna(r.profit) else np.nan
        if p4 is not None:
            if r.revenue > 0 and p4.revenue > 0:
                f["res_rev_yoy"] = float(np.clip(np.log(r.revenue / p4.revenue), -1, 1))
            f["res_np_yoy"] = float(_sym_growth(r.profit, p4.profit))
            f["res_eps_yoy"] = float(_sym_growth(r.eps, p4.eps))
            if r.revenue > 0 and p4.revenue > 0:
                f["res_margin_chg"] = float(np.clip(r.profit / r.revenue - p4.profit / p4.revenue, -.5, .5))
        # Trailing year-on-year changes of earlier quarters, each from quarters known by now.
        hist = []
        for _, q in prior.iloc[::-1].head(8).iterrows():
            q4 = lag(q.periodEnd)
            if q4 is not None:
                growth = np.log(q.revenue / q4.revenue) if q.revenue > 0 and q4.revenue > 0 else np.nan
                hist.append((q.profit - q4.profit, growth))
        if p4 is not None and len(hist) >= 4:
            dp = np.array([h[0] for h in hist], float)
            sd = np.nanstd(dp, ddof=1)
            if sd > 0:
                f["res_sue"] = float(np.clip((r.profit - p4.profit - np.nanmean(dp[:4])) / sd, -5, 5))
            rev = np.array([h[1] for h in hist[:4]], float)
            if pd.notna(f["res_rev_yoy"]) and np.isfinite(rev).sum() >= 2:
                f["res_rev_accel"] = float(np.clip(f["res_rev_yoy"] - np.nanmean(rev), -1, 1))
        out.append(f)
    return pd.concat([g, pd.DataFrame(out)], axis=1)


def results_features(root, cal, stocks, disclosures=None, timing="announcement", quarters=None, meetings=None):
    """Wide (date x stock) frames of results inputs, each known by that session's 18:00 cutoff.

    disclosures: ml.news_study.load_disclosures; meetings: ml.disclosure_features.load_meetings."""
    q = load_quarters(root) if quarters is None else quarters.copy()
    n = len(cal)
    frames = {k: pd.DataFrame(np.nan, index=cal, columns=stocks) for k in FEATURES}
    frames["res_available"][:] = 0.0
    q = q.loc[q.symbol.isin(stocks)]
    if q.empty:
        return frames
    q = q.assign(known=known_times(q, disclosures, timing, meetings))
    q["k"] = known_session(q.known, cal)
    for symbol, g in q.groupby("symbol"):
        g = quarter_features(g)
        ends, ks = g.periodEnd.to_numpy(), g.k.to_numpy()
        # The latest quarter (by period end) among those known at each session.
        latest = np.full(n, -1)
        for j in range(len(g)):
            if ks[j] >= n:
                continue
            prev = latest[ks[j]:]
            latest[ks[j]:] = np.where((prev < 0) | (ends[np.maximum(prev, 0)] <= ends[j]), j, prev)
        sel = np.flatnonzero(latest >= 0)
        sel = sel[(cal[sel] - ends[latest[sel]]).days <= STALE_DAYS]
        if not len(sel):
            continue
        rows = g.iloc[latest[sel]]
        for k in QUARTER:
            frames[k].iloc[sel, frames[k].columns.get_loc(symbol)] = rows[k].to_numpy()
        since = np.minimum(sel - rows.k.to_numpy(), 126).astype(float)
        col = frames["res_sess_since"].columns.get_loc(symbol)
        frames["res_sess_since"].iloc[sel, col] = since
        frames["res_abs_sue"].iloc[sel, col] = np.abs(rows.res_sue.to_numpy())
        frames["res_sue_fresh"].iloc[sel, col] = rows.res_sue.to_numpy() * np.exp(-since / 21)
        frames["res_available"].iloc[sel, col] = 1.0
    return frames


def add_results_features(long, root, cal, stocks, pick, disclosures=None, timing="announcement", quarters=None, meetings=None):
    for k, v in results_features(root, cal, stocks, disclosures, timing, quarters, meetings).items():
        long[k] = pick(v)
    return long
