"""Collect point-in-time NSE corporate disclosures for the research universe.

Run: python -m ml.news_history collect --data-dir data/pulse                  (full 10-year history)
     python -m ml.news_history collect --recent 60 --only board-meetings  (daily incremental update)

Source: NSE's public corporate-announcement and board-meeting listings. Every row
keeps NSE's own dissemination timestamp, which is what makes historical
backtests honest: a disclosure is usable only after that moment. Requests are
sequential and rate limited; a blocked or failed request is recorded, never
worked around.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from ml.pulse import atomic_json, utcnow

BASE = "https://www.nseindia.com/api"
ENDPOINTS = {"announcements": "corporate-announcements", "board-meetings": "corporate-board-meetings"}
PAUSE = 1.5
LOOKAHEAD_DAYS = 90
KEYS = {"announcements": lambda r: str(r.get("seq_id")),
        "board-meetings": lambda r: "|".join(str(r.get(k)) for k in ("bm_date", "bm_purpose", "bm_timestamp"))}


def fetch(endpoint, symbol, start, end):
    query = urllib.parse.urlencode({"index": "equities", "symbol": symbol, "from_date": start, "to_date": end})
    req = urllib.request.Request(f"{BASE}/{endpoint}?{query}", headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as res:
        return json.loads(res.read().decode("utf-8"))


def merge(target, name, fresh, start, end):
    """Union of stored and freshly fetched rows; a stored row is never dropped."""
    old = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {"rows": []}
    rows = {KEYS[name](r): r for r in old["rows"]}
    rows.update({KEYS[name](r): r for r in fresh})
    return {"symbol": target.stem, "fetchedAt": utcnow(), "from": old.get("from", start), "to": end, "rows": list(rows.values())}


def collect(data_dir, start="18-10-2016", end=None, recent=None, only=None):
    root = Path(data_dir)
    end = end or time.strftime("%d-%m-%Y")
    if recent:
        start = time.strftime("%d-%m-%Y", time.localtime(time.time() - recent * 86400))
        # NSE filters board meetings by meeting date, so announced future meetings need a future end date.
        end = time.strftime("%d-%m-%Y", time.localtime(time.time() + LOOKAHEAD_DAYS * 86400))
    endpoints = {k: v for k, v in ENDPOINTS.items() if not only or k in only}
    symbols = sorted(json.loads(p.read_text(encoding="utf-8")).get("symbol") for p in (root / "candles").glob("*.json")
                     if not json.loads(p.read_text(encoding="utf-8")).get("benchmark"))
    out = root / "news-history"
    status = {"startedAt": utcnow(), "source": "nseindia.com public corporate listings", "from": start, "to": end,
              "mode": f"recent {recent} days" if recent else "full", "feeds": list(endpoints), "symbols": {}}
    for i, symbol in enumerate(symbols):
        row = {}
        for name, endpoint in endpoints.items():
            target = out / name / f"{symbol}.json"
            try:
                data = fetch(endpoint, symbol, start, end)
                if not isinstance(data, list):
                    raise ValueError("unexpected response shape")
                atomic_json(target, merge(target, name, data, start, end))
                row[name] = len(data)
            except Exception as error:  # recorded, not retried around a block
                row[name] = f"error: {type(error).__name__}: {str(error)[:120]}"
            time.sleep(PAUSE)
        status["symbols"][symbol] = row
        print(f"[{i + 1}/{len(symbols)}] {symbol} {row}", flush=True)
        atomic_json(out / ("status.json" if not recent else "status-recent.json"), status)
    status["finishedAt"] = utcnow()
    failed = sum(any(isinstance(v, str) for v in row.values()) for row in status["symbols"].values())
    status["failedSymbols"] = failed
    atomic_json(out / ("status.json" if not recent else "status-recent.json"), status)
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["collect"])
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--recent", type=int, help="fetch only the last N days and merge into the stored history")
    parser.add_argument("--only", nargs="+", choices=list(ENDPOINTS), help="feeds to fetch (default: all)")
    args = parser.parse_args()
    status = collect(args.data_dir, recent=args.recent, only=args.only)
    print(json.dumps({"symbols": len(status["symbols"]), "failedSymbols": status["failedSymbols"], "mode": status["mode"]}))
    # A blocked or unreachable source is reported to the caller; stored history stays intact.
    if status["failedSymbols"] > len(status["symbols"]) // 2:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
