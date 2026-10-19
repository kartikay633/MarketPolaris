"""Filing reader, stage 1 pilot: draw the 100 filings, fetch their PDFs, extract their text.

Run: python -m ml.filing_pilot sample --data-dir data/pulse   (fixed seed; written once, never redrawn)
     python -m ml.filing_pilot fetch  --data-dir data/pulse   (PDFs from NSE's archive, rate limited)
     python -m ml.filing_pilot text   --data-dir data/pulse   (pypdf text, page count, scanned flag)

Protocol: ml/FILING_READER_PROTOCOL.md. The sample is drawn at random within material NSE
categories from the development period (2022-01-01 to 2024-12-03), stratified so every category
is represented, before any filing is read. PDFs and text live outside the repository under
PULSE_FILING_DIR (default D:/MarketPulseML/filings).
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from ml.news_study import load_disclosures
from ml.pulse import atomic_json, utcnow

SEED = 20261019
SIZE = 100
PERIOD = (pd.Timestamp("2022-01-01"), pd.Timestamp("2024-12-04"))
PAUSE = 1.5
MAX_BYTES = 8 * 1024 * 1024
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "*/*"}
# NSE categories that can carry price-relevant facts beyond the headline (protocol, stage 1).
MATERIAL = ["Press Release", "Outcome of Board Meeting", "Financial Result Updates", "Disclosure under SEBI Takeover Regulations",
            "Acquisition", "Change in Management", "Credit Rating", "News Verification", "Action(s) taken or orders passed",
            "Action(s) initiated or orders passed", "Resignation", "Cessation", "Related Party Transaction",
            "Related Party Transactions", "Monthly Business Updates", "Amalgamation/Merger", "Change in Auditors",
            "Pendency of Litigation(s)/dispute(s) or the outcome impacting the Company", "Investor Presentation"]


def filing_dir():
    return Path(os.environ.get("PULSE_FILING_DIR", "D:/MarketPulseML/filings"))


def attachments(root):
    """seq -> PDF link, from the stored announcement history."""
    links = {}
    for path in (root / "news-history" / "announcements").glob("*.json"):
        obj = json.loads(path.read_text(encoding="utf-8"))
        for r in obj["rows"]:
            link = r.get("attchmntFile") or ""
            if link.lower().endswith(".pdf"):
                links[(obj["symbol"], str(r.get("seq_id")))] = link
    return links


def sample(data_dir):
    root = Path(data_dir)
    out = filing_dir() / "pilot" / "sample.json"
    if out.exists():
        raise SystemExit(f"{out} exists; the pilot sample is drawn once and never redrawn")
    d = load_disclosures(root)
    d = d.loc[(d.ts >= PERIOD[0]) & (d.ts < PERIOD[1]) & d.category.isin(MATERIAL)].copy()
    links = attachments(root)
    d["pdf"] = [links.get((s, q)) for s, q in zip(d.symbol, d.seq)]
    d = d.dropna(subset=["pdf"])
    rng = np.random.default_rng(SEED)
    cats = sorted(d.category.unique())
    per = int(np.ceil(SIZE / len(cats)))
    picks = []
    for cat in cats:
        g = d.loc[d.category == cat]
        picks.append(g.iloc[rng.permutation(len(g))[:per]])
    s = pd.concat(picks)
    s = s.iloc[rng.permutation(len(s))[:SIZE]].sort_values("ts")
    rows = [{"symbol": r.symbol, "seq": r.seq, "ts": r.ts.isoformat(), "category": r.category, "headline": r.text, "pdf": r.pdf}
            for r in s.itertuples()]
    out.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(out, {"drawnAt": utcnow(), "seed": SEED, "period": [p.date().isoformat() for p in PERIOD],
                      "categories": {c: int((s.category == c).sum()) for c in cats}, "filings": rows})
    print(f"{len(rows)} filings across {len(cats)} categories -> {out}")


def fetch(data_dir):
    base = filing_dir() / "pilot"
    meta = json.loads((base / "sample.json").read_text(encoding="utf-8"))
    status = []
    for f in meta["filings"]:
        path = base / "pdf" / f"{f['symbol']}_{f['seq']}.pdf"
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(urllib.request.Request(f["pdf"], headers=HEADERS), timeout=90) as res:
                raw = res.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError("larger than 8 MB")
            if not raw.startswith(b"%PDF"):
                raise ValueError("not a PDF")
            path.write_bytes(raw)
            status.append({"seq": f["seq"], "ok": True, "bytes": len(raw)})
        except Exception as err:  # recorded, never worked around
            status.append({"seq": f["seq"], "ok": False, "error": str(err)[:200]})
        time.sleep(PAUSE)
    atomic_json(base / "fetch-status.json", {"at": utcnow(), "results": status})
    print(f"fetched {sum(s['ok'] for s in status)}, failed {sum(not s['ok'] for s in status)}")


def text(data_dir):
    from pypdf import PdfReader

    base = filing_dir() / "pilot"
    meta = json.loads((base / "sample.json").read_text(encoding="utf-8"))
    summary = []
    for f in meta["filings"]:
        pdf = base / "pdf" / f"{f['symbol']}_{f['seq']}.pdf"
        if not pdf.exists():
            continue
        try:
            reader = PdfReader(pdf)
            pages = [p.extract_text() or "" for p in reader.pages]
        except Exception as err:
            summary.append({"seq": f["seq"], "error": str(err)[:200]})
            continue
        body = "\n\n".join(f"[page {i + 1}]\n{t}" for i, t in enumerate(pages))
        (base / "text").mkdir(exist_ok=True)
        (base / "text" / f"{f['symbol']}_{f['seq']}.txt").write_text(body, encoding="utf-8")
        chars = sum(len(t.strip()) for t in pages)
        summary.append({"seq": f["seq"], "symbol": f["symbol"], "category": f["category"], "pages": len(pages), "chars": chars,
                        "scanned": chars < 200 * max(1, len(pages))})
    atomic_json(base / "text-summary.json", {"at": utcnow(), "filings": summary})
    s = pd.DataFrame(summary)
    if len(s) and "pages" in s:
        print(f"{len(s)} PDFs: median {s.pages.median():.0f} pages, {s.chars.median():.0f} chars; scanned (no text layer): {int(s.scanned.sum())}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["sample", "fetch", "text"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    {"sample": sample, "fetch": fetch, "text": text}[args.command](args.data_dir)


if __name__ == "__main__":
    main()
