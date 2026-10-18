"""Collect NSE's historical F&O bhavcopies for implied-volatility research.

Run: python -m ml.fo_history collect --data-dir data/pulse            (full history, resumable)
     python -m ml.fo_history collect --recent 10                       (daily incremental update)

Source: NSE's public daily derivatives bhavcopy archive (end-of-day prices of
every futures and options contract). Two official formats exist: the legacy
file (content/historical/DERIVATIVES/YYYY/MON/foDDMONYYYYbhav.csv.zip) up to
5 July 2024 and the UDiFF file (content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip)
from 8 July 2024. Only sessions in the NIFTY 50 candle calendar are requested,
sequentially and rate limited; a blocked or failed request is recorded, never
worked around.

Each day is stored as data/pulse/fo-history/days/YYYY-MM-DD.csv.gz holding stock
futures and traded stock options only (index contracts and options with no trades
that day are dropped), limited to the three nearest expiries per stock, to keep
the archive small. The official
symbol-change list maps old tickers to the universe's current ones.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import time
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from ml.pulse import atomic_json, utcnow

ARCHIVE = "https://nsearchives.nseindia.com/content"
UDIFF_FROM = pd.Timestamp("2024-07-08")
SYMBOL_CHANGES = f"{ARCHIVE}/equities/symbolchange.csv"
PAUSE = 1.0
EXPIRIES = 3
COLUMNS = ["symbol", "kind", "expiry", "strike", "close", "settle", "volume", "oi", "underlying"]
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "*/*"}


def urls(day):
    legacy =f"{ARCHIVE}/historical/DERIVATIVES/{day:%Y}/{day.strftime('%b').upper()}/fo{day.strftime('%d%b%Y').upper()}bhav.csv.zip"
    udiff = f"{ARCHIVE}/fo/BhavCopy_NSE_FO_0_0_0_{day:%Y%m%d}_F_0000.csv.zip"
    return [udiff, legacy] if day >= UDIFF_FROM else [legacy, udiff]


def download(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90) as res:
        return res.read()


def read_zip(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        return pd.read_csv(z.open(name), low_memory=False)


def normalise(raw):
    """Either bhavcopy format -> stock futures/options in one schema (kind FUT, CE or PE)."""
    raw = raw.rename(columns=str.strip)
    if "INSTRUMENT" in raw:  # legacy
        d = raw.loc[raw.INSTRUMENT.isin(["FUTSTK", "OPTSTK"])]
        out = pd.DataFrame({"symbol": d.SYMBOL.str.strip(), "kind": d.OPTION_TYP.str.strip().replace({"XX": "FUT"}),
                            "expiry": pd.to_datetime(d.EXPIRY_DT.str.strip(), format="%d-%b-%Y"), "strike": d.STRIKE_PR,
                            "close": d.CLOSE, "settle": d.SETTLE_PR, "volume": d.CONTRACTS, "oi": d.OPEN_INT,
                            "underlying": float("nan")})
    else:  # UDiFF
        d = raw.loc[raw.FinInstrmTp.isin(["STF", "STO"])]
        out = pd.DataFrame({"symbol": d.TckrSymb.str.strip(),
                            "kind": d.OptnTp.where(d.FinInstrmTp == "STO", "FUT").fillna("FUT").str.strip(),
                            "expiry": pd.to_datetime(d.XpryDt), "strike": d.StrkPric.fillna(0), "close": d.ClsPric,
                            "settle": d.SttlmPric, "volume": d.TtlTradgVol, "oi": d.OpnIntrst, "underlying": d.UndrlygPric})
    out.loc[out.kind == "FUT", "strike"] = 0.
    near = (out[["symbol", "expiry"]].drop_duplicates().sort_values("expiry")
            .groupby("symbol").head(EXPIRIES))
    out = out.merge(near, on=["symbol", "expiry"])
    out = out.loc[(out.kind == "FUT") | (out.volume > 0)]  # untraded options carry no market price
    return out[COLUMNS].sort_values(["symbol", "expiry", "kind", "strike"]).reset_index(drop=True)


def trading_days(root):
    obj = json.loads((Path(root) / "candles" / "NIFTY_50.json").read_text(encoding="utf-8"))
    return sorted({pd.Timestamp(row[0][:10]) for row in obj["candles"]})


def collect(data_dir, recent=None, start=None):
    root = Path(data_dir)
    out = root / "fo-history"
    days = [d for d in trading_days(root) if d >= pd.Timestamp(start or "2016-10-01")]
    if recent:
        days = days[-recent:]
    status_path = out / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.exists() else {"days": {}}
    status.update({"startedAt": utcnow(), "source": "nsearchives.nseindia.com F&O bhavcopy (legacy and UDiFF)"})
    try:
        raw = download(SYMBOL_CHANGES)
        pd.read_csv(io.BytesIO(raw))  # validate before replacing the stored copy
        out.mkdir(parents=True, exist_ok=True)
        (out / "symbol-changes.csv").write_bytes(raw)
        time.sleep(PAUSE)
    except Exception as error:
        status["symbolChanges"] = f"error: {type(error).__name__}: {str(error)[:120]}"
    for i, day in enumerate(days):
        target = out / "days" / f"{day.date().isoformat()}.csv.gz"
        if target.exists():
            continue
        result = None
        for url in urls(day):
            try:
                frame = normalise(read_zip(download(url)))
                target.parent.mkdir(parents=True, exist_ok=True)
                temp = target.with_name(target.name + ".tmp")
                frame.to_csv(temp, index=False, date_format="%Y-%m-%d", compression="gzip")
                os.replace(temp, target)  # readers never see a half-written day
                result = {"url": url, "rows": int(len(frame))}
                break
            except Exception as error:  # recorded, not retried around a block
                result = {"url": url, "error": f"{type(error).__name__}: {str(error)[:120]}"}
                if getattr(error, "code", None) not in (404,):  # only a missing file tries the other format
                    break
            finally:
                time.sleep(PAUSE)
        status["days"][day.date().isoformat()] = result
        print(f"[{i + 1}/{len(days)}] {day.date()} {result}", flush=True)
        if i % 20 == 0:
            atomic_json(status_path, status)
    status["finishedAt"] = utcnow()
    status["failedDays"] = sorted(k for k, v in status["days"].items() if v and "error" in v)
    atomic_json(status_path, status)
    return status


def symbol_map(root, universe):
    """Old ticker -> (current universe ticker, date the old ticker stopped), chained through NSE's symbol-change list."""
    path = Path(root) / "fo-history" / "symbol-changes.csv"
    if not path.exists():
        return {}
    changes = pd.read_csv(path, dtype=str).rename(columns=str.strip)
    step = {str(o).strip(): (str(n).strip(), pd.to_datetime(str(t).strip(), format="%d-%b-%Y", errors="coerce"))
            for o, n, t in zip(changes["OLD SYMBOL"], changes["NEW SYMBOL"], changes["EFFECTIVE DATE"])}
    mapping = {}
    for old, (_, effective) in step.items():
        new, seen = old, set()
        while new in step and new not in seen:
            seen.add(new)
            new = step[new][0]
        if new in universe and pd.notna(effective):
            mapping[old] = (new, effective)
    return mapping


def read_day(path, mapping, universe):
    """One stored day restricted to the universe.

    An old ticker is renamed only on days before its NSE effective date, so a
    ticker later reused by another company is never merged into this one."""
    day = pd.Timestamp(Path(path).name[:10])
    d = pd.read_csv(path, parse_dates=["expiry"])
    rename = {old: new for old, (new, effective) in mapping.items() if day < effective}
    d["symbol"] = d.symbol.replace(rename)
    return d.loc[d.symbol.isin(universe)].reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["collect"])
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--recent", type=int)
    parser.add_argument("--start")
    args = parser.parse_args()
    status = collect(args.data_dir, args.recent, args.start)
    print(json.dumps({"days": len(status["days"]), "failedDays": len(status["failedDays"])}))


if __name__ == "__main__":
    main()
