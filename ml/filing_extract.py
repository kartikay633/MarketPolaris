"""Filing reader, stage 1 pilot: local Qwen models extract facts from the 100 sampled filings.

Run: python -m ml.filing_extract run --model qwen3:4b      (then --model qwen2.5:7b)
     python -m ml.filing_extract summary                    (timing and verification per model)

Protocol: ml/FILING_READER_PROTOCOL.md. Each filing's text (ml.filing_pilot text) is trimmed to the
cover letter plus the passages most likely to carry facts (numbers and key words), then read by
the model through Ollama at temperature 0 with a fixed JSON schema.

Every extracted fact must carry a short quote from the filing. A fact is kept only if its quote
and every number in its value appear in the filing text (ignoring spacing and case, since PDF text
often splits words). Dropped facts are counted, never repaired. Grading against the PDFs happens
afterwards, outside this script.
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from pathlib import Path

from ml.filing_pilot import filing_dir
from ml.pulse import atomic_json, utcnow

OLLAMA = "http://localhost:11434/api/chat"
CONTEXT = 4096         # with one Ollama slot
GPU_LAYERS = 20        # leaves VRAM headroom on a 4 GB GPU; more layers spilled into system RAM and froze the laptop
FULL_TEXT = 7000       # characters: shorter filings are read whole
COVER = 2500           # characters of the first page always kept
BUDGET = 7000          # characters sent for longer filings
CHUNK = 700
KEYWORDS = re.compile(r"order|contract|worth|valued|crore|lakh|million|billion|resign|appoint|cessation|auditor|pledge|encumb|"
                      r"rating|upgrade|downgrade|outlook|acqui|merger|amalgam|stake|penalt|fine|order passed|demand|litigation|"
                      r"guidance|revenue|profit|ebitda|margin|loss|dividend|record date|buyback|allot|qip|preferential|"
                      r"reason|with effect|effective|w\.e\.f", re.I)
EVENTS = ["results", "order_win", "acquisition", "merger", "management_change", "auditor_change", "credit_rating",
          "regulatory_action", "litigation", "related_party", "pledge_or_stake", "capital_raise", "dividend_or_buyback",
          "business_update", "clarification", "other"]
SCHEMA = {
    "type": "object",
    "properties": {
        "event_type": {"type": "string", "enum": EVENTS},
        "summary": {"type": "string"},
        "headline_missing_material_info": {"type": "boolean"},
        "facts": {"type": "array", "maxItems": 8, "items": {"type": "object", "properties": {
            "fact": {"type": "string"}, "value": {"type": ["string", "null"]}, "quote": {"type": "string"}},
            "required": ["fact", "value", "quote"]}},
        "company_impact": {"type": "string", "enum": ["positive", "negative", "neutral", "unclear"]},
        "materiality": {"type": "string", "enum": ["low", "medium", "high"]},
        "red_flags": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
    },
    "required": ["event_type", "summary", "headline_missing_material_info", "facts", "company_impact", "materiality", "red_flags"],
}
SYSTEM = f"""You read official stock-exchange filings by Indian listed companies and extract facts for an analyst.
Use ONLY the filing text provided. Never use outside knowledge, never guess, never compute new numbers.
- event_type: one of {", ".join(EVENTS)}.
- summary: at most two plain sentences on what the filing says.
- headline_missing_material_info: true only if the filing contains a material fact (an amount, percentage, reason,
  date, counterparty or condition) that the one-line NSE headline does not state.
- facts: up to 8 of the most important facts, most important first. Each has "fact" (a description of at most
  10 words), "value" (only the key amount, percentage, date, name or short phrase, at most 12 words, exactly as
  written in the filing, or null) and "quote" (an exact excerpt of 5 to 25 words copied from the filing that
  contains the value). Skip boilerplate such as company descriptions and addresses.
- company_impact: the direct effect on the company as the filing describes it; "unclear" when the filing does not say.
  This is not a share-price prediction.
- materiality: low (routine), medium, or high (could change an investor's view of the company).
- red_flags: short items only when the filing itself states them (for example a resignation citing concerns,
  a penalty, a qualified audit opinion, a default, a rating downgrade). Otherwise an empty list.
Return JSON only."""


def free_ram_gb():
    """Free physical memory (Windows); None elsewhere."""
    try:
        import ctypes

        class Status(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        s = Status()
        s.dwLength = ctypes.sizeof(Status)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))
        return s.ullAvailPhys / 1024 ** 3
    except Exception:
        return None


def memory_guard(minimum=1.5, wait=60, give_up=10):
    """Pause while free RAM is below minimum GB; False after give_up minutes so the run stops cleanly."""
    for _ in range(give_up):
        free = free_ram_gb()
        if free is None or free >= minimum:
            return True
        print(f"  low memory ({free:.1f} GB free); pausing {wait}s", flush=True)
        time.sleep(wait)
    return False


def norm(s):
    return re.sub(r"[^0-9a-z]", "", (s or "").lower())


def trim(text):
    """Whole text for short filings; otherwise the cover letter plus the highest-scoring passages, in order."""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    if len(text) <= FULL_TEXT:
        return text
    head, rest = text[:COVER], text[COVER:]
    chunks = [rest[i:i + CHUNK] for i in range(0, len(rest), CHUNK)]
    score = lambda c: len(KEYWORDS.findall(c)) * 2 + len(re.findall(r"\d[\d,.]*", c)) * .2
    ranked = sorted(range(len(chunks)), key=lambda i: -score(chunks[i]))
    keep, used = [], len(head)
    for i in ranked:
        if used + len(chunks[i]) > BUDGET:
            break
        keep.append(i)
        used += len(chunks[i])
    return head + "\n[...]\n" + "\n[...]\n".join(chunks[i] for i in sorted(keep))


def verify(result, text):
    """Keep facts whose quote and value numbers appear in the full filing text; count the rest."""
    full = norm(text)
    kept, dropped = [], []
    for f in result.get("facts") or []:
        quote_ok = len(norm(f.get("quote"))) >= 8 and norm(f.get("quote")) in full
        numbers = re.findall(r"\d[\d,]*(?:\.\d+)?", f.get("value") or "")
        numbers_ok = all(norm(n) in full for n in numbers)
        (kept if quote_ok and numbers_ok else dropped).append({**f, "quoteFound": quote_ok, "numbersFound": numbers_ok})
    return kept, dropped


def ask(model, headline, category, body):
    payload = {"model": model, "stream": False, "format": SCHEMA, "options": {"temperature": 0, "num_ctx": CONTEXT, "num_predict": 1200, "num_gpu": GPU_LAYERS},
               "messages": [{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": f"NSE category: {category}\nNSE headline: {headline}\n\nFiling text:\n{body}"}]}
    if model.startswith("qwen3"):
        payload["think"] = False
    req = urllib.request.Request(OLLAMA, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as res:
        out = json.load(res)
    return out["message"]["content"], out.get("prompt_eval_count"), out.get("eval_count")


def stay_awake():
    """Ask Windows not to idle-sleep while this process runs (released when it exits; no setting changes)."""
    try:
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    except Exception:
        pass


def run(model, limit=None):
    stay_awake()
    base = filing_dir() / "pilot"
    sample = json.loads((base / "sample.json").read_text(encoding="utf-8"))["filings"]
    out_dir = base / "extract" / model.replace(":", "_")
    out_dir.mkdir(parents=True, exist_ok=True)
    done = 0
    for f in sample:
        name = f"{f['symbol']}_{f['seq']}"
        src, dst = base / "text" / f"{name}.txt", out_dir / f"{name}.json"
        if not src.exists() or dst.exists():
            continue
        if not memory_guard():
            print("stopping: free memory stayed below 1.5 GB for 10 minutes", flush=True)
            break
        text = src.read_text(encoding="utf-8")
        record = {"symbol": f["symbol"], "seq": f["seq"], "category": f["category"], "headline": f["headline"], "model": model,
                  "chars": len(text), "sentChars": None, "at": utcnow()}
        if len(text.strip()) < 200:
            record["status"] = "no text layer (scanned)"
        else:
            body = trim(text)
            record["sentChars"] = len(body)
            t0 = time.time()
            try:
                raw, prompt_tokens, out_tokens = ask(model, f["headline"], f["category"], body)
                result = json.loads(raw)
                kept, dropped = verify(result, text)
                record.update(status="ok", seconds=round(time.time() - t0, 1), promptTokens=prompt_tokens, outputTokens=out_tokens,
                              result={**result, "facts": kept}, droppedFacts=dropped)
            except Exception as err:  # recorded, the run continues
                record.update(status="error", seconds=round(time.time() - t0, 1), error=str(err)[:300])
        atomic_json(dst, record)
        done += 1
        print(f"{model} {done} {name} {record['status']} {record.get('seconds', '')}s", flush=True)
        if limit and done >= limit:
            break


def summary():
    base = filing_dir() / "pilot" / "extract"
    out = {}
    for d in sorted(p for p in base.iterdir() if p.is_dir()):
        recs = [json.loads(p.read_text(encoding="utf-8")) for p in d.glob("*.json")]
        ok = [r for r in recs if r["status"] == "ok"]
        kept = sum(len(r["result"]["facts"]) for r in ok)
        dropped = sum(len(r["droppedFacts"]) for r in ok)
        secs = sorted(r["seconds"] for r in ok)
        out[d.name] = {"filings": len(recs), "ok": len(ok), "errors": sum(r["status"] == "error" for r in recs),
                       "scanned": sum(r["status"].startswith("no text") for r in recs),
                       "medianSeconds": secs[len(secs) // 2] if secs else None, "totalMinutes": round(sum(secs) / 60, 1),
                       "factsKept": kept, "factsDropped": dropped,
                       "dropRate": round(dropped / (kept + dropped), 3) if kept + dropped else None,
                       "saysHeadlineMissesInfo": sum(bool(r["result"].get("headline_missing_material_info")) for r in ok)}
    atomic_json(base / "summary.json", {"at": utcnow(), "models": out})
    print(json.dumps(out, indent=1))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["run", "summary"])
    parser.add_argument("--model", default="qwen3:4b")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(args.model, args.limit) if args.command == "run" else summary()


if __name__ == "__main__":
    main()
