"""Collect NSE trading-flow data (delivery and bulk/block deals) for v5 research.

Run: python -m ml.flow_history collect --data-dir data/pulse            (full history, resumable)
     python -m ml.flow_history collect --recent 10                       (daily incremental update)

Sources (NSE public archives and report pages):

* Delivery: the security-wise full bhavcopy
  (products/content/sec_bhavdata_full_DDMMYYYY.csv: traded quantity, delivered
  quantity and delivery percentage), which the archive holds from late 2019. Earlier
  sessions use NSE's security-wise delivery position file
  (archives/equities/mto/MTO_DDMMYYYY.DAT), the same delivery figures in the older
  layout. Both are published after the session's close.
* Bulk and block deals: NSE's "bulk and block deals" report
  (api/historicalOR/bulk-block-short-deals, its CSV download), one request per
  calendar month and deal type, disseminated on the deal date after the close. The
  older api/historical/bulk-deals path answers 503 and is not used.

Only sessions in the NIFTY 50 candle calendar are requested, sequentially with a
pause between requests. A missing (404) or unreadable file (NSE served at least
one day as an Excel workbook) tries the other delivery layout; network failures
are recorded and not retried. A block (HTTP 401/403/429/503 or an HTML page where
data was expected) stops the run and is recorded; it is never worked around.

Stored under data/pulse/flow-history/:
* delivery/YYYY-MM-DD.csv.gz: symbol, series, traded, delivered, delivPct (series EQ/BE/BZ)
* deals/{bulk,block}-YYYY-MM.csv.gz: date, symbol, client, side, qty, price
* status.json: one entry per session and per month (source URL, rows or error)
"""
from __future__ import annotations

import argparse
import http.cookiejar
import io
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

from ml.fo_history import trading_days
from ml.pulse import atomic_json, utcnow

ARCHIVE = "https://nsearchives.nseindia.com"
SITE = "https://www.nseindia.com"
DEALS_PAGE = f"{SITE}/report-detail/display-bulk-and-block-deals"
FULL_FROM = pd.Timestamp("2019-10-01")
START = "2016-01-01"
PAUSE = 1.0
SERIES = ["EQ", "BE", "BZ"]
DELIVERY_COLUMNS = ["symbol", "series", "traded", "delivered", "delivPct"]
DEAL_COLUMNS = ["date", "symbol", "client", "side", "qty", "price"]
DEAL_TYPES = {"bulk": "bulk_deals", "block": "block_deals"}
BLOCK_CODES = (401, 403, 429, 503)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


class Blocked(Exception):
    pass


def delivery_urls(day):
    full = f"{ARCHIVE}/products/content/sec_bhavdata_full_{day:%d%m%Y}.csv"
    mto = f"{ARCHIVE}/archives/equities/mto/MTO_{day:%d%m%Y}.DAT"
    return [full, mto] if day >= FULL_FROM else [mto, full]


def fetch(opener, url, accept="*/*", referer=None, page=False):
    headers = {"User-Agent": UA, "Accept": accept}
    if referer:
        headers["Referer"] = referer
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=90) as res:
            raw = res.read()
    except urllib.error.HTTPError as error:
        if error.code in BLOCK_CODES:
            raise Blocked(f"HTTP {error.code} from {url}") from error
        raise
    if not page and raw[:200].lstrip().lower().startswith((b"<!doctype", b"<html")):
        raise Blocked(f"HTML page instead of data from {url}")
    return raw


def parse_full(raw):
    d = pd.read_csv(io.BytesIO(raw), skipinitialspace=True, dtype=str).rename(columns=str.strip)
    d = d.apply(lambda c: c.str.strip())
    return pd.DataFrame({"symbol": d.SYMBOL, "series": d.SERIES, "traded": pd.to_numeric(d.TTL_TRD_QNTY, errors="coerce"),
                         "delivered": pd.to_numeric(d.DELIV_QTY, errors="coerce"),
                         "delivPct": pd.to_numeric(d.DELIV_PER, errors="coerce")})


def parse_mto(raw):
    rows = []
    for line in raw.decode("latin-1").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 7 and parts[0] == "20":
            rows.append(parts[2:7])
    d = pd.DataFrame(rows, columns=["symbol", "series", "traded", "delivered", "delivPct"])
    for c in ("traded", "delivered", "delivPct"):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    return d


def normalise_delivery(d):
    d = d.loc[d.series.isin(SERIES) & d.symbol.notna()]
    return d[DELIVERY_COLUMNS].sort_values(["symbol", "series"]).reset_index(drop=True)


def parse_deals(raw):
    """The report's CSV download (the JSON view of the same report stops at 70 rows)."""
    d = pd.read_csv(io.BytesIO(raw), encoding="utf-8-sig", dtype=str).rename(columns=lambda c: c.strip())
    d = d.loc[d.Date.notna() & (d.Date.str.strip().str.upper() != "NO RECORDS")]
    if d.empty:
        return pd.DataFrame(columns=DEAL_COLUMNS)
    num = lambda c: pd.to_numeric(d[c].str.replace(",", "").str.strip(), errors="coerce")
    return pd.DataFrame({"date": pd.to_datetime(d.Date.str.strip(), format="%d-%b-%Y").dt.date.astype(str),
                         "symbol": d.Symbol.str.strip(), "client": d["Client Name"].str.strip(),
                         "side": d["Buy / Sell"].str.strip().str.upper(), "qty": num("Quantity Traded"),
                         "price": num("Trade Price / Wght. Avg. Price")})[DEAL_COLUMNS]


def write_gz(frame, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + ".tmp")
    frame.to_csv(temp, index=False, compression="gzip")
    os.replace(temp, target)  # readers never see a half-written file


def collect_delivery(opener, out, days, status, save):
    for i, day in enumerate(days):
        target = out / "delivery" / f"{day.date().isoformat()}.csv.gz"
        if target.exists():
            continue
        result = None
        for url in delivery_urls(day):
            try:
                raw = fetch(opener, url)
                frame = normalise_delivery(parse_full(raw) if "sec_bhavdata_full" in url else parse_mto(raw))
                if frame.empty:
                    raise ValueError("no equity rows")
                write_gz(frame, target)
                result = {"url": url, "rows": int(len(frame))}
                break
            except Blocked as error:
                status["delivery"][day.date().isoformat()] = {"url": url, "error": f"blocked: {error}"}
                raise
            except Exception as error:  # recorded; a missing or unreadable file tries the other layout, a network error does not
                result = {"url": url, "error": f"{type(error).__name__}: {str(error)[:120]}"}
                if isinstance(error, OSError) and getattr(error, "code", None) != 404:
                    break
            finally:
                time.sleep(PAUSE)
        status["delivery"][day.date().isoformat()] = result
        print(f"[delivery {i + 1}/{len(days)}] {day.date()} {result}", flush=True)
        if i % 20 == 0:
            save()


def collect_deals(opener, out, months, status, save):
    today = pd.Timestamp.today().normalize()
    try:
        fetch(opener, DEALS_PAGE, accept="text/html", page=True)  # sets the session cookies the report API requires
    except Exception:
        pass  # the page may answer 403 while still setting cookies; the API calls decide
    time.sleep(PAUSE)
    for month in months:
        last = min(month + pd.offsets.MonthEnd(0), today)
        complete = month + pd.offsets.MonthEnd(0) < today
        for kind, option in DEAL_TYPES.items():
            key = f"{kind}-{month:%Y-%m}"
            target = out / "deals" / f"{key}.csv.gz"
            if target.exists() and status["deals"].get(key, {}).get("complete"):
                continue
            url = f"{SITE}/api/historicalOR/bulk-block-short-deals?optionType={option}&from={month:%d-%m-%Y}&to={last:%d-%m-%Y}&csv=true"
            try:
                frame = parse_deals(fetch(opener, url, accept="text/csv", referer=DEALS_PAGE))
                write_gz(frame, target)
                result = {"url": url, "rows": int(len(frame)), "complete": bool(complete)}
            except Blocked as error:
                status["deals"][key] = {"url": url, "error": f"blocked: {error}"}
                raise
            except Exception as error:
                result = {"url": url, "error": f"{type(error).__name__}: {str(error)[:120]}"}
            finally:
                time.sleep(PAUSE)
            status["deals"][key] = result
            print(f"[deals] {key} {result}", flush=True)
        save()


def collect(data_dir, recent=None, start=None, only=None):
    root = Path(data_dir)
    out = root / "flow-history"
    days = [d for d in trading_days(root) if d >= pd.Timestamp(start or START)]
    if recent:
        days = days[-recent:]
    months = sorted({d.to_period("M").to_timestamp() for d in days})
    status_path = out / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.exists() else {}
    status.setdefault("delivery", {})
    status.setdefault("deals", {})
    status.update({"startedAt": utcnow(), "blocked": None,
                   "source": "nsearchives.nseindia.com sec_bhavdata_full / MTO; nseindia.com bulk-block-short-deals report"})
    save = lambda: atomic_json(status_path, status)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    try:
        if only in (None, "delivery"):
            collect_delivery(opener, out, days, status, save)
        if only in (None, "deals"):
            collect_deals(opener, out, months, status, save)
    except Blocked as error:  # stop politely; the next run resumes from what is stored
        status["blocked"] = {"at": utcnow(), "error": str(error)}
        print(f"BLOCKED, stopping: {error}", flush=True)
    status["finishedAt"] = utcnow()
    status["failedDays"] = sorted(k for k, v in status["delivery"].items() if v and "error" in v)
    status["failedMonths"] = sorted(k for k, v in status["deals"].items() if v and "error" in v)
    save()
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["collect"])
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--recent", type=int)
    parser.add_argument("--start")
    parser.add_argument("--only", choices=["delivery", "deals"])
    args = parser.parse_args()
    status = collect(args.data_dir, args.recent, args.start, args.only)
    print(json.dumps({"days": len(status["delivery"]), "failedDays": len(status["failedDays"]),
                      "months": len(status["deals"]), "failedMonths": len(status["failedMonths"]), "blocked": status["blocked"]}))


if __name__ == "__main__":
    main()
