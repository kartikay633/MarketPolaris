"""How NSE corporate disclosures move stocks: an event study on point-in-time filings.

Run: python -m ml.news_study run --data-dir data/pulse

For every disclosure the event session (d0) is the first session that opens after
NSE's dissemination time (before 09:15 IST counts the same day). Reactions are
abnormal versus NIFTY 50:

* gap      previous close -> d0 open (not tradable: it happens at the open)
* day0     previous close -> d0 close (the full first-day reaction)
* drift5   d0 open -> d4 close   (tradable after the disclosure)
* drift20  d0 open -> d19 close
* z0       |day0| divided by the stock's 20-session volatility before d0

Groups: NSE's own category, keyword events (promoter or chairman death, pledges,
resignations, rating changes, raids, orders, buybacks) and, when available, the
local LLM's event type and tone (data/pulse/news-history/tags.json).
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

from ml.pulse import atomic_json, load_candles, utcnow

OPEN = pd.Timedelta(hours=9, minutes=15)
KEYWORDS = {
    "promoter_or_chairman_death": r"demise|passed away|untimely death|sad death|death of (?:our|the|mr|shri|smt|dr)",
    "promoter_pledge": r"pledg|encumbran",
    "ceo_md_cfo_resignation": r"resign\w*.{0,80}(?:managing director|chief executive|\bceo\b|\bcfo\b|chief financial|whole[- ]time director)|(?:managing director|chief executive|\bceo\b|\bcfo\b|chief financial).{0,80}resign",
    "auditor_resignation": r"auditor.{0,60}resign|resign.{0,60}auditor",
    "credit_rating_upgrade": r"upgrad",
    "credit_rating_downgrade": r"downgrad",
    "raid_search_fraud": r"search (?:and|&) seizure|income tax (?:department|authorities).{0,40}(?:search|survey)|enforcement directorate|\bfraud\b|forensic audit",
    "order_win": r"(?:bags|secured|received|wins?|won|bagged).{0,60}order|order.{0,40}(?:worth|valued|value of)",
    "buyback": r"buy[- ]?back",
    "block_or_bulk_stake_sale": r"offer for sale|stake sale|block deal",
    "news_rumour_clarification": r"clarification|news verification|news item|media report",
}


def load_disclosures(root):
    rows = []
    for path in sorted((root / "news-history" / "announcements").glob("*.json")):
        obj = json.loads(path.read_text(encoding="utf-8"))
        for r in obj["rows"]:
            # Dissemination time when NSE recorded it (older rows show "-"), else the announcement time.
            stamp = r.get("exchdisstime") if len(r.get("exchdisstime") or "") >= 12 else r.get("an_dt")
            rows.append({"symbol": obj["symbol"], "seq": str(r.get("seq_id")), "ts": stamp, "category": (r.get("desc") or "").strip(),
                         "text": (r.get("attchmntText") or "").strip()})
    d = pd.DataFrame(rows)
    d["ts"] = pd.to_datetime(d.ts, format="mixed", dayfirst=True, errors="coerce")
    d = d.dropna(subset=["ts"]).drop_duplicates(["symbol", "seq"]).sort_values("ts").reset_index(drop=True)
    d["category"] = d.category.str.replace(r"\s+", " ", regex=True)
    return d


def event_sessions(ts, cal):
    day = ts.dt.normalize()
    before_open = (ts - day) < OPEN
    left = np.searchsorted(cal.values, day.values, side="left")
    right = np.searchsorted(cal.values, day.values, side="right")
    return np.where(before_open, left, right)


def reactions(d, frames, meta):
    cal = frames["NIFTY_50"].index
    m_o, m_c = frames["NIFTY_50"].open.reindex(cal).to_numpy(), frames["NIFTY_50"].close.reindex(cal).to_numpy()
    d = d.copy()
    d["i0"] = event_sessions(d.ts, cal)
    out = []
    for symbol, g in d.groupby("symbol"):
        if symbol not in frames:
            continue
        f = frames[symbol].reindex(cal)
        o, c = f.open.to_numpy(), f.close.to_numpy()
        vol = pd.Series(c).pct_change(fill_method=None).rolling(20, min_periods=18).std().to_numpy()
        i = g.i0.to_numpy()
        ok = (i >= 1) & (i + 19 < len(cal))
        ii = np.where(ok, i, 1)
        rel = lambda a, b: a - b
        gap = rel(o[ii] / c[ii - 1], m_o[ii] / m_c[ii - 1])
        day0 = rel(c[ii] / c[ii - 1], m_c[ii] / m_c[ii - 1])
        j5, j20 = np.minimum(ii + 4, len(cal) - 1), np.minimum(ii + 19, len(cal) - 1)
        drift5 = rel(c[j5] / o[ii], m_c[j5] / m_o[ii])
        drift20 = rel(c[j20] / o[ii], m_c[j20] / m_o[ii])
        z0 = np.abs(day0) / vol[ii - 1]
        part = g.assign(gap=gap, day0=day0, drift5=drift5, drift20=drift20, z0=z0, eventDate=cal[ii])
        out.append(part.loc[ok])
    r = pd.concat(out).replace([np.inf, -np.inf], np.nan).dropna(subset=["day0"])
    # Overlapping corporate actions (splits, demergers) create artificial jumps; drop impossible moves.
    return r.loc[r.day0.abs() < .5]


def summary(x):
    def stat(col):
        v = x[col].dropna()
        n = len(v)
        t = float(v.mean() / (v.std() / math.sqrt(n))) if n > 2 and v.std() > 0 else None
        return {"mean": float(v.mean()), "median": float(v.median()), "positiveShare": float((v > 0).mean()), "t": t}
    return {"events": int(len(x)), "stocks": int(x.symbol.nunique()), "day0": stat("day0"), "gap": stat("gap"),
            "drift5": stat("drift5"), "drift20": stat("drift20"),
            "meanAbsMoveInSigma": float(x.z0.mean()), "shareMovesAbove2Sigma": float((x.z0 > 2).mean())}


def run(data_dir):
    root = Path(data_dir)
    frames, meta, _, _ = load_candles(root)
    d = load_disclosures(root)
    tags_file = root / "news-history" / "tags.json"
    if tags_file.exists():
        tags = pd.DataFrame(json.loads(tags_file.read_text(encoding="utf-8"))["tags"])
        d = d.merge(tags, on=["symbol", "seq"], how="left")
    r = reactions(d, frames, meta)
    text = (r.category + " " + r.text).str.lower()
    groups = {"all_disclosures": r}
    for name, pattern in KEYWORDS.items():
        groups[f"keyword:{name}"] = r.loc[text.str.contains(pattern, regex=True)]
    big = r.category.value_counts()
    for cat in big.index[big >= 40]:
        groups[f"nse:{cat}"] = r.loc[r.category == cat]
    if "event" in r:
        for (ev, tone), g in r.dropna(subset=["event"]).groupby(["event", "tone"]):
            if len(g) >= 20:
                groups[f"llm:{ev}:{tone}"] = g
    # Baseline: every stock-session, to compare how unusual disclosure days are.
    cal = frames["NIFTY_50"].index
    base = []
    for s in r.symbol.unique():
        c = frames[s].close.reindex(cal)
        ret = c.pct_change(fill_method=None) - frames["NIFTY_50"].close.reindex(cal).pct_change(fill_method=None)
        base.append((ret.abs() / c.pct_change(fill_method=None).rolling(20, min_periods=18).std().shift(1)).dropna())
    base = pd.concat(base)
    result = {"generatedAt": utcnow(), "status": "research", "source": "NSE corporate announcements (dissemination timestamps)",
              "period": [r.ts.min().isoformat(), r.ts.max().isoformat()], "disclosures": int(len(d)), "scored": int(len(r)),
              "baselineAllSessions": {"meanAbsMoveInSigma": float(base.mean()), "shareMovesAbove2Sigma": float((base > 2).mean())},
              "groups": {k: summary(g) for k, g in groups.items() if len(g) >= 5}}
    atomic_json(root / "reports" / "news-study.json", result)
    r.to_pickle(root / "news-history" / "reactions.pkl")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["run"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    result = run(args.data_dir)
    print(json.dumps({"disclosures": result["disclosures"], "scored": result["scored"], "groups": len(result["groups"])}))


if __name__ == "__main__":
    main()
