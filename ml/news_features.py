"""Point-in-time features from the application's append-only observed news store.

Publication alone never grants historical eligibility. Modern LLM output and
user-supplied archive flags are ignored; rule counts use only observed versions.
"""
import hashlib
import json
import re
from pathlib import Path

import pandas as pd

NEWS_FEATURES = ["news_count7", "news_earnings7", "news_capital7", "news_regulatory7",
                 "news_business7", "news_corrections7", "news_sources7"]


def timestamp(value):
    if not isinstance(value, str) or not re.search(r"T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$", value):
        raise ValueError("News timestamps require an explicit timezone")
    return pd.Timestamp(value).tz_convert("UTC")


def load_events(data_dir):
    path = Path(data_dir) / "news.json"
    if not path.exists():
        return []
    store = json.loads(path.read_text(encoding="utf-8"))
    if store.get("schemaVersion") != 1 or not isinstance(store.get("events"), list):
        raise ValueError("Unsupported observed news schema")
    return store["events"]


def prepare_events(events):
    prepared = []
    for event in events:
        try:
            observed = timestamp(event["firstSeenAt"])
            published = timestamp(event["publishedAt"])
            if event.get("provenance") != "observed-import":
                continue
            available = max(observed, published)
            # Recompute categories from literal evidence; never consume stored
            # model classifications which could contain hindsight knowledge.
            text = f'{event.get("title", "")} {event.get("excerpt", "")}'.lower()
            kinds = [bool(re.search(pattern, text)) for pattern in [
                r"financial results|quarterly results|earnings|profit",
                r"dividend|buyback|bonus|split|rights issue",
                r"penalty|seizure|regulat|sebi|court|litigation",
                r"contract|order win|acquisition|merger",
                r"corrigendum|correction|clarification"]]
            prepared.append({"available": available, "symbols": event.get("symbols", []),
                             "sourceType": event.get("sourceType"), "source": event.get("sourceId"),
                             "id": event.get("id"), "url": event.get("sourceUrl"),
                             "contentHash": event.get("contentHash"), "kinds": kinds})
        except (ValueError, KeyError, TypeError):
            continue
    return sorted(prepared, key=lambda e: (e["available"], str(e["id"])))


def attach_news(dataset, events):
    """Daily signal is after the 15:30 IST close; later news waits a session."""
    prepared = prepare_events(events)
    result = dataset.copy()
    for feature in NEWS_FEATURES:
        result[feature] = 0.
    for index, row in result.iterrows():
        as_of = pd.Timestamp(row.date).tz_localize("Asia/Kolkata") + pd.Timedelta(hours=15, minutes=30)
        earliest = as_of - pd.Timedelta(days=7)
        eligible = [e for e in prepared if earliest < e["available"] <= as_of and
                    (row.symbol in e["symbols"] or (not e["symbols"] and e["sourceType"] == "regulator"))]
        # Revisions supersede the prior version only after observed. Identical
        # syndicated text is counted once, irrespective of later corrections.
        current = {e["url"] or e["id"]: e for e in eligible}
        unique = {e["contentHash"] or e["id"]: e for e in current.values()}
        items = list(unique.values())
        values = [len(items)] + [sum(e["kinds"][i] for e in items) for i in range(5)] + [len({e["source"] for e in items})]
        result.loc[index, NEWS_FEATURES] = values
    return result


def news_ablation(dataset, events, horizon, artifact_dir, train_fn):
    prepared = prepare_events(events)
    common = {"eventsObserved": len(events), "validObservedVersions": len(prepared),
              "method": "Rules on literal observed text; no Gemini features, author reputation scores or hindsight labels",
              "availabilityPolicy": "max(publication, first observation) <= 15:30 Asia/Kolkata signal timestamp",
              "limitation": "Sparse observed stream; absence of events does not prove complete source coverage. No causal source/reporter reliability claim."}
    if not prepared:
        return {**common, "status": "unavailable", "reason": "No verified point-in-time observed news records"}
    first = min(e["available"] for e in prepared)
    # Restrict both models to identical dates after observation began. Never
    # call zeros from years before collection a meaningful news ablation.
    as_of = pd.DatetimeIndex(dataset.date).tz_localize("Asia/Kolkata") + pd.Timedelta(hours=15, minutes=30)
    matched = dataset.loc[as_of >= first].copy()
    common.update({"firstObservedAt": first.isoformat(), "eligibleSessions": int(matched.date.nunique()),
                   "eligibleStockDates": len(matched), "minimumSessions": 450, "minimumStockDates": 1000})
    if matched.date.nunique() < 450 or len(matched) < 1000:
        return {**common, "status": "unavailable", "reason": "Insufficient mature observed news history for purged training, calibration and unseen evaluation"}
    news_data = attach_news(matched, events)
    if int((news_data.news_count7 > 0).sum()) < 100:
        return {**common, "status": "unavailable", "reason": "Fewer than 100 stock-date rows contain eligible observed news"}
    from ml.pulse import FEATURES, atomic_json
    data_digest = hashlib.sha256(news_data.to_json(date_format="iso", orient="split").encode()).hexdigest()
    folder = Path(artifact_dir) / f"news-ablation-{horizon}-{data_digest[:16]}"
    report_path = folder / "report.json"
    if report_path.exists():
        return json.loads(report_path.read_text(encoding="utf-8"))
    market_dir, news_dir = folder / "market", folder / "news"
    market_dir.mkdir(parents=True, exist_ok=True)
    news_dir.mkdir(parents=True, exist_ok=True)
    market = train_fn(matched, horizon, market_dir)
    news = train_fn(news_data, horizon, news_dir, FEATURES + NEWS_FEATURES)
    report = {**common, "status": "evaluated", "featureDataHash": data_digest, "marketOnly": market,
              "newsAware": news, "accuracyDelta": news["holdout"]["accuracy"]-market["holdout"]["accuracy"],
              "logLossDelta": news["holdout"]["logLoss"]-market["holdout"]["logLoss"],
              "sameRowsAndSplits": True, "automaticPromotion": False}
    atomic_json(report_path, report)
    return report
