"""Filing reader, stage 1: grading sheet and scoring for the pilot extractions.

Run: python -m ml.filing_grade sheet --model qwen3_4b [--start 0 --count 15]   (print facts with source context)
     python -m ml.filing_grade score --model qwen3_4b                          (score grades against the gate)

Grades are written by the reviewer to PULSE_FILING_DIR/pilot/grades-<model>.json as
{"<symbol>_<seq>": {"<fact index>": "correct" | "wrong" | "unsupported", ...}, ...}

* correct: the fact's description and value say what the filing says.
* wrong: the value or the meaning differs from the filing (wrong number, wrong party, wrong direction).
* unsupported: the quote exists, but the fact claims more than the quote or the filing supports.

Gate (ml/FILING_READER_PROTOCOL.md, stage 1): at least 90% of facts correct, and at least 95% of
facts carrying a number correct.
"""
from __future__ import annotations

import argparse
import json
import re

from ml.filing_pilot import filing_dir

CONTEXT = 260


def records(model):
    base = filing_dir() / "pilot"
    out = []
    for path in sorted((base / "extract" / model).glob("*.json")):
        r = json.loads(path.read_text(encoding="utf-8"))
        if r.get("status") == "ok":
            r["text"] = (base / "text" / f"{path.stem}.txt").read_text(encoding="utf-8")
            r["id"] = path.stem
            out.append(r)
    return out


def context(text, quote):
    """The filing text around the quote (matching ignores spacing and case, like the verifier)."""
    flat = re.sub(r"\s+", " ", text)
    key = re.sub(r"\s+", " ", quote or "").strip()
    i = flat.lower().find(key.lower()[:60])
    if i < 0:
        return "(context not located by exact match)"
    return flat[max(0, i - CONTEXT):i + len(key) + CONTEXT]


def sheet(model, start, count):
    recs = records(model)
    for r in recs[start:start + count]:
        res = r["result"]
        print(f"\n##### {r['id']} | {r['category']} | {res.get('event_type')} | materiality={res.get('materiality')} | headline-misses={res.get('headline_missing_material_info')}")
        print(f"HEADLINE: {r['headline'][:220]}")
        print(f"SUMMARY: {res.get('summary', '')[:300]}")
        for i, f in enumerate(res.get("facts", [])):
            print(f"  [{i}] FACT: {f.get('fact')} | VALUE: {f.get('value')}")
            print(f"      CONTEXT: ...{context(r['text'], f.get('quote'))}...")
    print(f"\n(records {start}-{min(start + count, len(recs)) - 1} of {len(recs)})")


def score(model):
    recs = {r["id"]: r for r in records(model)}
    grades = json.loads((filing_dir() / "pilot" / f"grades-{model}.json").read_text(encoding="utf-8"))
    total = correct = numeric = numeric_ok = 0
    by_kind, missing = {}, 0
    for rid, r in recs.items():
        g = grades.get(rid)
        facts = r["result"].get("facts", [])
        if g is None:
            missing += len(facts)
            continue
        for i, f in enumerate(facts):
            verdict = g.get(str(i))
            if verdict is None:
                missing += 1
                continue
            total += 1
            ok = verdict == "correct"
            correct += ok
            by_kind[verdict] = by_kind.get(verdict, 0) + 1
            if re.search(r"\d", f.get("value") or ""):
                numeric += 1
                numeric_ok += ok
    fact_rate = correct / total if total else 0
    num_rate = numeric_ok / numeric if numeric else 0
    out = {"model": model, "graded": total, "ungraded": missing, "verdicts": by_kind,
           "factAccuracy": round(fact_rate, 4), "numericFacts": numeric, "numericAccuracy": round(num_rate, 4),
           "passesGate": bool(fact_rate >= .90 and num_rate >= .95 and missing == 0)}
    print(json.dumps(out, indent=1))
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["sheet", "score"])
    p.add_argument("--model", default="qwen3_4b")
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--count", type=int, default=15)
    a = p.parse_args()
    sheet(a.model, a.start, a.count) if a.command == "sheet" else score(a.model)


if __name__ == "__main__":
    main()
