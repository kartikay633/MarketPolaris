"""Tag NSE disclosures with a local LLM (Ollama, Qwen 2.5) for research features.

Run: python -m ml.news_tags tag --data-dir data/pulse [--model qwen2.5:3b] [--limit N]

Only disclosure text is sent, to a model running on this machine. Routine
filings whose NSE category already says everything (lost share certificates,
newspaper copies, trading windows, ...) are not tagged. Output is resumable and
written to data/pulse/news-history/tags.json keyed by (symbol, NSE seq id).
Tags are model output and are evaluated, never trusted: their value is judged by
event studies and walk-forward tests like any other feature.
"""
from __future__ import annotations

import argparse
import json
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ml.news_study import load_disclosures
from ml.pulse import atomic_json, utcnow

OLLAMA = "http://localhost:11434/api/generate"
EVENTS = ["results", "guidance_or_business_update", "dividend", "buyback", "bonus_or_split", "acquisition_or_merger",
          "divestment_or_demerger", "fundraise_or_dilution", "order_or_contract_win", "capacity_or_product_launch",
          "management_change", "promoter_or_key_person_death", "promoter_stake_change_or_pledge", "credit_rating",
          "litigation_or_regulatory_action", "tax_raid_or_fraud", "rumour_clarification", "accident_strike_or_disruption",
          "routine_compliance", "other"]
TONES = ["positive", "negative", "neutral"]
SKIP = ("loss of share certificate", "loss of share certificates", "copy of newspaper publication", "newspaper advertisements",
        "trading window", "closure of trading window", "certificate under sebi (depositories and participants)",
        "issue of duplicate share certificate", "esop/esos/esps", "esop/esps/sbeb scheme", "allotment of esop/esps",
        "annual secretarial compliance report", "corrigendum", "registrar & share transfer agent update",
        "schedule of analysts/institutional investor meet/con. call updates", "transcript of analysts/institutional investor meet/con. call",
        "recording of analysts/institutional investor meet/con. call", "code of conduct under sebi(pit) reg., 2015", "postal ballot",
        # Notices whose category already carries the information; tone adds little.
        "analysts/institutional investor meet/con. call updates", "shareholders meeting", "record date", "book closure",
        "allotment of securities", "annual general meeting", "appointment", "cessation", "investor presentation",
        "related party transactions", "related party transaction", "certificate under sebi (depositories and participants) regulations, 2018",
        "schedule of analysts/institutional investor meet/con. call", "change in director(s)", "loss of share certificate")
PROMPT = ("You label Indian stock exchange disclosures for a research dataset. Read the disclosure and return JSON only: "
          '{"event": one of ' + json.dumps(EVENTS) + ', "tone": one of ' + json.dumps(TONES) + ', "magnitude": integer 0-3 '
          "(0 routine, 1 minor, 2 notable, 3 major for the company's share price)}. Tone is the likely effect on the company's "
          "shareholders, not the wording. Company: {name}. NSE category: {category}. Disclosure: {text}")


def ask(model, prompt):
    body = json.dumps({"model": model, "prompt": prompt, "stream": False, "format": "json",
                       "options": {"temperature": 0, "num_predict": 60}}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as res:
        out = json.loads(json.loads(res.read())["response"])
    event = out.get("event") if out.get("event") in EVENTS else "other"
    tone = out.get("tone") if out.get("tone") in TONES else "neutral"
    try:
        magnitude = max(0, min(3, int(out.get("magnitude", 0))))
    except (TypeError, ValueError):
        magnitude = 0
    return {"event": event, "tone": tone, "magnitude": magnitude}


def tag(data_dir, model="qwen2.5:3b", limit=None, workers=4):
    root = Path(data_dir)
    target = root / "news-history" / "tags.json"
    store = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {"model": model, "tags": []}
    done = {(t["symbol"], t["seq"]) for t in store["tags"]}
    d = load_disclosures(root)
    d = d.loc[~d.category.str.lower().isin(SKIP) & (d.text.str.len() > 20)]
    todo = d.loc[[(s, q) not in done for s, q in zip(d.symbol, d.seq)]]
    if limit:
        todo = todo.head(limit)
    by_text = {}
    for row in todo.itertuples():
        by_text.setdefault((row.category, row.text[:350]), []).append((row.symbol, row.seq))
    print(f"{len(todo):,} disclosures to tag ({len(by_text):,} unique texts); {len(done):,} already tagged", flush=True)
    lock, started, count = threading.Lock(), time.time(), [0]

    def work(item):
        (category, text), keys = item
        try:
            result = ask(model, PROMPT.replace("{name}", keys[0][0]).replace("{category}", category).replace("{text}", text))
        except Exception as error:  # a failed call leaves the rows untagged for a later resume
            print(f"  skipped: {type(error).__name__}", flush=True)
            return
        with lock:
            store["tags"].extend({"symbol": s, "seq": q, **result} for s, q in keys)
            count[0] += 1
            if count[0] % 500 == 0:
                store["model"], store["updatedAt"] = model, utcnow()
                atomic_json(target, store)
                rate = count[0] / (time.time() - started)
                print(f"  {count[0]:,}/{len(by_text):,} texts, {rate:.1f}/s, ~{(len(by_text) - count[0]) / rate / 60:.0f} min left", flush=True)

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(work, by_text.items()))
    store["model"], store["updatedAt"] = model, utcnow()
    atomic_json(target, store)
    return store


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["tag"])
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--model", default="qwen2.5:3b")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    store = tag(args.data_dir, args.model, args.limit)
    print(json.dumps({"tagged": len(store["tags"]), "model": store["model"]}))


if __name__ == "__main__":
    main()
