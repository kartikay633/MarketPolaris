"""Point-in-time features from historical NSE disclosures (data/pulse/news-history).

Results calendar: a board meeting to consider financial results counts from the
first session whose 18:00 IST cutoff is after NSE disseminated the intimation, so
a meeting date is never used before the market knew it. Disclosure flow and
local-LLM tags count only filings disseminated before that same cutoff.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

CUTOFF = pd.Timedelta(hours=18)
CAP = 30
RESULTS = r"financial result|quarterly result|audited result|unaudited result"
RESULTS_FEATURES = ["sess_to_results", "results_in_20", "sess_since_results", "results_expected_20"]


def known_session(ts, cal):
    """Index of the first session whose cutoff (date + 18:00) is at or after ts."""
    day = ts.dt.normalize()
    after_cutoff = ((ts - day) > CUTOFF).to_numpy()
    return np.where(after_cutoff, np.searchsorted(cal.values, day.values, side="right"),
                    np.searchsorted(cal.values, day.values, side="left"))


def load_meetings(root):
    rows = []
    for path in sorted((Path(root) / "news-history" / "board-meetings").glob("*.json")):
        obj = json.loads(path.read_text(encoding="utf-8"))
        for r in obj["rows"]:
            rows.append({"symbol": obj["symbol"], "meeting": r.get("bm_date"), "known": r.get("bm_timestamp"),
                         "purpose": f"{r.get('bm_purpose') or ''} {r.get('bm_desc') or ''}"})
    d = pd.DataFrame(rows)
    if d.empty:
        return d
    d["meeting"] = pd.to_datetime(d.meeting, format="mixed", dayfirst=True, errors="coerce")
    d["known"] = pd.to_datetime(d.known, format="mixed", dayfirst=True, errors="coerce")
    d = d.dropna(subset=["meeting", "known"])
    d = d.loc[d.purpose.str.lower().str.contains(RESULTS, regex=True)]
    return d.drop_duplicates(["symbol", "meeting"]).reset_index(drop=True)


def results_calendar(root, cal, stocks):
    """Wide (date x stock) frames of results-calendar features."""
    meetings = load_meetings(root)
    n = len(cal)
    to_next = pd.DataFrame(float(CAP), index=cal, columns=stocks)  # no known meeting = beyond the cap
    since = pd.DataFrame(np.nan, index=cal, columns=stocks)
    if meetings.empty:
        return {"sess_to_results": to_next, "results_in_20": (to_next <= 20).astype(float), "sess_since_results": since,
                "results_expected_20": since.copy()}
    meetings["k_known"] = known_session(meetings.known, cal)
    meetings["k_meet"] = np.searchsorted(cal.values, meetings.meeting.values, side="left")
    for symbol, g in meetings.groupby("symbol"):
        if symbol not in to_next:
            continue
        nxt = np.full(n, np.inf)
        last = np.full(n, -np.inf)
        for k_known, k_meet in zip(g.k_known.to_numpy(), g.k_meet.to_numpy()):
            if k_meet >= n + 60:
                continue
            lo, hi = max(0, k_known), min(n, k_meet)
            if lo < hi:  # known in advance and still upcoming
                idx = np.arange(lo, hi)
                nxt[lo:hi] = np.minimum(nxt[lo:hi], k_meet - idx)
            if k_meet < n:  # results are out from the meeting session onwards
                last[k_meet:] = np.maximum(last[k_meet:], k_meet)
        to_next[symbol] = np.where(np.isfinite(nxt), np.minimum(nxt, CAP), CAP)
        since[symbol] = np.where(np.isfinite(last), np.minimum(np.arange(n) - last, 252), np.nan)
    gap = 63 - since
    expected = (((gap >= 0) & (gap <= 20)) | (since > 63)).astype(float).where(since.notna())
    return {"sess_to_results": to_next, "results_in_20": (to_next <= 20).astype(float), "sess_since_results": since,
            "results_expected_20": expected}


FLOW_FEATURES = ["filings_1", "filings_5", "filings_20", "clarifications_20", "red_flags_60", "promoter_filings_20", "results_filed_5"]
RED_FLAGS = r"search (?:and|&) seizure|income tax (?:department|authorities).{0,40}(?:search|survey)|enforcement directorate|\bfraud\b|forensic audit|downgrad|auditor.{0,60}resign|resign.{0,60}auditor|default"


def disclosure_flow(disclosures, cal, stocks):
    """Wide counts of filings known by each session's 18:00 cutoff (disclosures from ml.news_study.load_disclosures)."""
    d = disclosures.loc[disclosures.symbol.isin(stocks)].copy()
    d["k"] = known_session(d.ts, cal)
    d = d.loc[d.k < len(cal)]
    low = (d.category + " " + d.text).str.lower()
    kinds = {"all": np.ones(len(d), bool),
             "clar": low.str.contains(r"clarification|news verification|rumour", regex=True).to_numpy(),
             "red": low.str.contains(RED_FLAGS, regex=True).to_numpy(),
             "promoter": low.str.contains(r"takeover regulations|sast|pledg|encumbran|promoter", regex=True).to_numpy(),
             "results": low.str.contains(r"financial result", regex=True).to_numpy()}
    daily = {}
    for name, mask in kinds.items():
        c = d.loc[mask].groupby(["k", "symbol"]).size().unstack(fill_value=0)
        daily[name] = c.reindex(index=range(len(cal)), columns=stocks, fill_value=0).set_axis(cal, axis=0).astype(float)
    roll = lambda x, n: x.rolling(n, min_periods=1).sum()
    return {"filings_1": daily["all"], "filings_5": roll(daily["all"], 5), "filings_20": roll(daily["all"], 20),
            "clarifications_20": roll(daily["clar"], 20), "red_flags_60": roll(daily["red"], 60),
            "promoter_filings_20": roll(daily["promoter"], 20), "results_filed_5": roll(daily["results"], 5)}
