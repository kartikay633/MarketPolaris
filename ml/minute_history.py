"""Collect Upstox 1-minute candles for intraday-volatility research (v5).

Run: python -m ml.minute_history collect --data-dir data/pulse             (full history, resumable)
     python -m ml.minute_history collect --data-dir data/pulse --recent 1  (current and previous month)

Source: Upstox V3 historical candles, 1-minute interval, which start in January
2022. One request per instrument and calendar month, sequential and rate limited
(Upstox allows 2,000 requests per 30 minutes). A failed month is recorded and
retried on the next run, never worked around.

Raw minutes are large (about 375 per stock per session), so they live outside the
repository data folder: PULSE_MINUTE_DIR, default D:/MarketPulseML/minute, as
<SYMBOL>/<YYYY-MM>.csv.gz. Completed past months are not downloaded again; the
current month is refreshed on every run.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

from ml.pulse import atomic_json, utcnow

START = pd.Timestamp("2022-01-01")
PAUSE = .95
COLUMNS = ["time", "open", "high", "low", "close", "volume"]


def minute_dir():
    return Path(os.environ.get("PULSE_MINUTE_DIR", "D:/MarketPulseML/minute"))


def token():
    for key in ("UPSTOX_ANALYTICS_TOKEN", "UPSTOX_ACCESS_TOKEN"):
        if os.environ.get(key):
            return os.environ[key]
    env = Path(".env")
    if env.exists():
        values = dict(line.split("=", 1) for line in env.read_text(encoding="utf-8").splitlines() if "=" in line and not line.lstrip().startswith("#"))
        for key in ("UPSTOX_ANALYTICS_TOKEN", "UPSTOX_ACCESS_TOKEN"):
            if values.get(key, "").strip():
                return values[key].strip().strip('"').strip("'")
    raise SystemExit("Configure UPSTOX_ANALYTICS_TOKEN in .env")


def fetch(key, start, end, auth):
    url = (f"https://api.upstox.com/v3/historical-candle/{urllib.parse.quote(key, safe='')}"
           f"/minutes/1/{end:%Y-%m-%d}/{start:%Y-%m-%d}")
    # Upstox's edge rejects Python's default user agent; this one names the app honestly.
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {auth}", "Accept": "application/json", "User-Agent": "MarketPulse-research/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                body = json.load(res)
            rows = body.get("data", {}).get("candles", [])
            frame = pd.DataFrame([r[:6] for r in rows], columns=COLUMNS)
            return frame.sort_values("time").drop_duplicates("time")
        except urllib.error.HTTPError as err:
            if err.code == 429 and attempt < 3:
                time.sleep(60 * (attempt + 1))
                continue
            raise


def months(recent=None, today=None):
    today = pd.Timestamp(today or pd.Timestamp.now(tz="Asia/Kolkata").date())
    first = today.to_period("M") - recent if recent is not None else START.to_period("M")
    return list(pd.period_range(first, today.to_period("M"), freq="M"))


def collect(data_dir, recent=None):
    root = Path(data_dir)
    manifest = json.loads((root / "collection.json").read_text(encoding="utf-8"))
    instruments = [i for i in manifest["instruments"] if i.get("instrumentKey")]
    out_dir = minute_dir()
    auth = token()
    current = pd.Timestamp.now(tz="Asia/Kolkata").to_period("M")
    report = {"startedAt": utcnow(), "directory": str(out_dir), "instruments": len(instruments), "downloaded": 0, "skipped": 0, "empty": 0, "failed": []}
    for n, inst in enumerate(instruments, 1):
        target = out_dir / inst["symbol"]
        target.mkdir(parents=True, exist_ok=True)
        for month in months(recent):
            path = target / f"{month}.csv.gz"
            if path.exists() and month < current:
                report["skipped"] += 1
                continue
            try:
                frame = fetch(inst["instrumentKey"], month.start_time, month.end_time.normalize(), auth)
            except Exception as err:  # recorded and retried next run
                report["failed"].append({"symbol": inst["symbol"], "month": str(month), "error": str(err)[:200]})
                time.sleep(PAUSE)
                continue
            if frame.empty:
                report["empty"] += 1
            tmp = path.with_suffix(".tmp")
            frame.to_csv(tmp, index=False, compression="gzip")
            os.replace(tmp, path)
            report["downloaded"] += 1
            time.sleep(PAUSE)
        print(f"{n}/{len(instruments)} {inst['symbol']} downloaded={report['downloaded']} failed={len(report['failed'])}", flush=True)
    report["completedAt"] = utcnow()
    atomic_json(root / "reports" / "minute-collection.json", report)
    return report


def load(symbol, start=None, end=None):
    """All stored minutes for one instrument, times in IST, optionally limited to [start, end]."""
    files = sorted((minute_dir() / symbol).glob("*.csv.gz"))
    if start is not None:
        files = [f for f in files if f.name[:7] >= pd.Timestamp(start).strftime("%Y-%m")]
    if end is not None:
        files = [f for f in files if f.name[:7] <= pd.Timestamp(end).strftime("%Y-%m")]
    frames = [pd.read_csv(f) for f in files]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.concat(frames, ignore_index=True)
    df["time"] = pd.to_datetime(df.time.str[:19])
    return df.drop_duplicates("time").sort_values("time").reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["collect"])
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--recent", type=int, help="only the current month and this many before it")
    args = parser.parse_args()
    report = collect(args.data_dir, args.recent)
    print(json.dumps({k: v if k != "failed" else len(v) for k, v in report.items()}))


if __name__ == "__main__":
    main()
