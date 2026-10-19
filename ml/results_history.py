"""Collect and parse quarterly financial-results XBRL filings for the research universe.

Run: python -m ml.results_history collect --data-dir data/pulse   (listings + XBRL, resumable)
     python -m ml.results_history parse --data-dir data/pulse     (writes results-history/quarters.csv)

Sources (NSE public listings; the owner has permission to use NSE data):
* corporates-financial-results (period=Quarterly): filings up to the December 2024
  quarter, XBRL from mid-2018;
* integrated-filing-results (type "Integrated Filing- Financials"): SEBI's integrated
  filing, from the March 2025 quarter.

Every filing keeps NSE's own dissemination timestamp, the only time used to make its
numbers known (ml.results_features). One basis per stock (consolidated when it covers
most quarters, else standalone) so that year-on-year changes compare like with like;
for each quarter the earliest disseminated filing is used, never a later revision.
Requests are sequential and rate limited; a blocked or failed request is recorded,
never worked around, and repeated blocks stop the run.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

from ml.pulse import atomic_json, utcnow

BASE = "https://www.nseindia.com/api"
LEGACY = "corporates-financial-results"
INTEGRATED = "integrated-filing-results"
PAUSE = 1.5
FIRST_QUARTER = pd.Timestamp("2015-03-31")
BLOCKED = {401, 403, 429}
MAX_BLOCKS = 3
XI = "{http://www.xbrl.org/2003/instance}"
DIM = "{http://xbrl.org/2006/xbrldi}explicitMember"
# First tag present wins. Banks and insurers file other taxonomies.
REVENUE = ["RevenueFromOperations", "InterestEarned", "TotalRevenueFromOperations", "IncomeFromOperations",
           "TotalIncomeFromOperations", "GrossPremiumIncome", "GrossPremiumsWritten", "Income", "TotalIncome"]
PROFIT = ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates",
          "ProfitLossForPeriod", "ProfitLossForThePeriod",
          "NetProfitLossForThePeriod", "ProfitLossAfterTaxAndShareOfProfitLossOfAssociates", "NetProfitLoss",
          "ProfitLossAfterTaxAndExtraordinaryItems", "ProfitLossAfterTax"]
EPS = ["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsLossPerShareFromContinuingOperations",
       "BasicEarningsPerShareAfterExtraordinaryItems", "BasicEarningsPerShareBeforeExtraordinaryItems", "BasicEarningsLossPerShare",
       "BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized"]


def get(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": accept})
    with urllib.request.urlopen(req, timeout=90) as res:
        return res.read()


def listing(symbol):
    legacy = json.loads(get(f"{BASE}/{LEGACY}?" + urllib.parse.urlencode({"index": "equities", "symbol": symbol, "period": "Quarterly"})))
    integrated = json.loads(get(f"{BASE}/{INTEGRATED}?" + urllib.parse.urlencode(
        {"index": "equities", "symbol": symbol, "type": "Integrated Filing- Financials"})))
    if not isinstance(legacy, list) or not isinstance(integrated, dict) or not isinstance(integrated.get("data"), list):
        raise ValueError("unexpected response shape")
    if integrated.get("totalCount", 0) > len(integrated["data"]):
        raise ValueError(f"integrated listing truncated: {len(integrated['data'])} of {integrated['totalCount']}")
    return legacy, integrated["data"]


def filings(legacy, integrated):
    """Normalised filing rows: period end, basis, dissemination time, XBRL link."""
    rows = []
    for r in legacy:
        if r.get("cumulative") not in (None, "Non-cumulative"):
            continue
        rows.append({"source": "legacy", "seq": str(r.get("seqNumber")), "periodEnd": r.get("toDate"),
                     "basis": "consolidated" if r.get("consolidated") == "Consolidated" else "standalone",
                     "disseminated": r.get("exchdisstime") or r.get("broadCastDate"), "xbrl": r.get("xbrl") or "",
                     "audited": r.get("audited")})
    for r in integrated:
        rows.append({"source": "integrated", "seq": str(r.get("seq_Id")), "periodEnd": r.get("qe_Date"),
                     "basis": "consolidated" if r.get("consolidated") == "Consolidated" else "standalone",
                     "disseminated": r.get("broadcast_Date"), "xbrl": r.get("xbrl") or "", "audited": r.get("audited")})
    d = pd.DataFrame(rows, columns=["source", "seq", "periodEnd", "basis", "disseminated", "xbrl", "audited"])
    d["periodEnd"] = pd.to_datetime(d.periodEnd, format="mixed", dayfirst=True, errors="coerce")
    d["disseminated"] = pd.to_datetime(d.disseminated, format="mixed", dayfirst=True, errors="coerce")
    d["hasXbrl"] = d.xbrl.str.lower().str.endswith(".xml")
    return d.dropna(subset=["periodEnd", "disseminated"])


def choose(d):
    """Earliest disseminated XBRL filing per quarter on the stock's one basis."""
    d = d.loc[d.hasXbrl & (d.periodEnd >= FIRST_QUARTER)]
    if d.empty:
        return d, None
    cover = d.groupby("basis").periodEnd.nunique()
    basis = "consolidated" if cover.get("consolidated", 0) >= .5 * d.periodEnd.nunique() else "standalone"
    d = d.loc[d.basis == basis].sort_values("disseminated")
    return d.drop_duplicates("periodEnd", keep="first").sort_values("periodEnd"), basis


def collect(data_dir, refresh=False, symbols=None):
    root = Path(data_dir)
    out = root / "results-history"
    universe = sorted(json.loads(p.read_text(encoding="utf-8")).get("symbol") for p in (root / "candles").glob("*.json")
                      if not json.loads(p.read_text(encoding="utf-8")).get("benchmark"))
    universe = [s for s in universe if not symbols or s in symbols]
    status_path = out / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.exists() else {"symbols": {}}
    status.update({"startedAt": utcnow(), "source": "nseindia.com financial-results and integrated-filing listings",
                   "finishedAt": None, "stopped": None})
    blocks = 0

    def fetch(url, accept):
        nonlocal blocks
        try:
            body = get(url, accept)
            blocks = 0
            return body
        except urllib.error.HTTPError as error:
            if error.code in BLOCKED:
                blocks += 1
            raise
        finally:
            time.sleep(PAUSE)

    for i, symbol in enumerate(universe):
        row = status["symbols"].get(symbol, {})
        target = out / "listings" / f"{symbol}.json"
        try:
            if refresh or not target.exists():
                try:
                    legacy, integrated = listing(symbol)
                finally:
                    time.sleep(PAUSE)
                atomic_json(target, {"symbol": symbol, "fetchedAt": utcnow(), "legacy": legacy, "integrated": integrated})
            obj = json.loads(target.read_text(encoding="utf-8"))
            chosen, basis = choose(filings(obj["legacy"], obj["integrated"]))
            row.update({"basis": basis, "quarters": int(len(chosen)), "errors": []})
            got = 0
            for url in chosen.xbrl:
                path = out / "xbrl" / symbol / url.rsplit("/", 1)[-1]
                if path.exists():
                    got += 1
                    continue
                try:
                    body = fetch(url, "application/xml,text/xml,*/*")
                    if b"<" not in body[:200]:
                        raise ValueError("not XML")
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(body)
                    got += 1
                except Exception as error:  # recorded, not retried around a block
                    row["errors"].append(f"{url.rsplit('/', 1)[-1]}: {type(error).__name__}: {str(error)[:100]}")
                    if blocks >= MAX_BLOCKS:
                        break
            row["downloaded"] = got
        except Exception as error:
            row["error"] = f"{type(error).__name__}: {str(error)[:120]}"
            if isinstance(error, urllib.error.HTTPError) and error.code in BLOCKED:
                blocks += 1
        status["symbols"][symbol] = row
        print(f"[{i + 1}/{len(universe)}] {symbol} {row.get('basis')} {row.get('downloaded')}/{row.get('quarters')}"
              f" errors={len(row.get('errors', []))} {row.get('error', '')}", flush=True)
        atomic_json(status_path, status)
        if blocks >= MAX_BLOCKS:
            status["stopped"] = f"stopped after {blocks} consecutive blocked responses at {symbol}; rerun later to resume"
            print(status["stopped"], flush=True)
            break
    status["finishedAt"] = utcnow()
    atomic_json(status_path, status)
    return status


def _number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def parse_xbrl(path, period_end):
    """Quarter revenue, net profit and basic EPS (INR) from one filing's undimensioned quarter context."""
    root = ET.parse(path).getroot()
    spans, dimensional = {}, set()
    for c in root.iter(f"{XI}context"):
        if next(c.iter(DIM), None) is not None:
            dimensional.add(c.get("id"))
            continue
        start, end = c.find(f"{XI}period/{XI}startDate"), c.find(f"{XI}period/{XI}endDate")
        if start is not None and end is not None:
            spans[c.get("id")] = (pd.Timestamp(start.text.strip()), pd.Timestamp(end.text.strip()))
    facts = {}
    for e in root:
        ref = e.get("contextRef")
        if ref and ref not in dimensional:  # some older filings reference contexts they never declare
            facts.setdefault(ref, {})[e.tag.rsplit("}", 1)[-1]] = (e.text or "").strip()
    # The filing's own reporting-period facts win over context header dates, which can disagree.
    quarter = None
    for ref, f in facts.items():
        start, end = spans.get(ref, (None, None))
        try:
            s = pd.Timestamp(f["DateOfStartOfReportingPeriod"]) if f.get("DateOfStartOfReportingPeriod") else start
            e = pd.Timestamp(f["DateOfEndOfReportingPeriod"]) if f.get("DateOfEndOfReportingPeriod") else end
        except ValueError:
            continue
        if s is None and e is not None and ref == "OneD":  # older bank filings omit the quarter start
            s = e - pd.DateOffset(months=3) + pd.Timedelta(days=1)
        if s is None or e is None:
            continue
        if abs((e - period_end).days) <= 3 and 80 <= (e - s).days <= 100 and any(k in f for k in REVENUE + PROFIT):
            if quarter is None or ref == "OneD":
                quarter = ref
    if quarter is None:
        return None
    f = facts[quarter]
    pick = lambda keys: next((v for v in (_number(f.get(k)) for k in keys) if v is not None), None)
    return {"revenue": pick(REVENUE), "profit": pick(PROFIT), "eps": pick(EPS),
            "boardMeeting": f.get("DateOfBoardMeetingWhenFinancialResultsWereApproved")}


def parse(data_dir):
    root = Path(data_dir) / "results-history"
    rows, failed = [], 0
    for target in sorted((root / "listings").glob("*.json")):
        obj = json.loads(target.read_text(encoding="utf-8"))
        chosen, basis = choose(filings(obj["legacy"], obj["integrated"]))
        for r in chosen.itertuples():
            path = root / "xbrl" / obj["symbol"] / r.xbrl.rsplit("/", 1)[-1]
            if not path.exists():
                continue
            try:
                values = parse_xbrl(path, r.periodEnd)
            except ET.ParseError:
                values = None
            if values is None:
                failed += 1
                continue
            rows.append({"symbol": obj["symbol"], "periodEnd": r.periodEnd.date().isoformat(), "basis": basis,
                         "disseminated": r.disseminated.isoformat(), "source": r.source, "seq": r.seq, **values})
    d = pd.DataFrame(rows)
    d.to_csv(root / "quarters.csv", index=False)
    print(json.dumps({"quarters": len(d), "symbols": int(d.symbol.nunique()) if len(d) else 0, "unparsed": failed,
                      "missing": {k: int(d[k].isna().sum()) for k in ("revenue", "profit", "eps")} if len(d) else {}}))
    return d


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["collect", "parse"])
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--refresh", action="store_true", help="refetch listings (new quarters)")
    parser.add_argument("--symbols", nargs="+")
    args = parser.parse_args()
    if args.command == "collect":
        status = collect(args.data_dir, args.refresh, args.symbols)
        print(json.dumps({"symbols": len(status["symbols"]), "stopped": status["stopped"]}))
        if status["stopped"]:
            raise SystemExit(1)
    else:
        parse(args.data_dir)


if __name__ == "__main__":
    main()
