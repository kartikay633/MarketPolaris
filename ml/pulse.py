"""Daily, next-open stock-direction research. Run: python -m ml.pulse --help.

All historical text features are deliberately excluded: contemporary LLMs may
remember subsequent events. Synthetic candles belong in tests, never this CLI.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import sklearn
from datetime import datetime, timezone, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

SEED = 271828
VERSION = "pulse-daily-v1"
HORIZONS = (5, 20)
FEATURES = ["return1", "return5", "return20", "return60", "volatility5",
            "volatility20", "range", "body", "overnight", "volume_ratio",
            "volume_change", "distance20", "distance60", "benchmark_return5",
            "benchmark_return20", "benchmark_volatility20", "relative_return20"]
LIMITATIONS = [
    "Experimental research; historical performance does not establish future profitability.",
    "Universe is selected using current instruments; survivorship and selection bias remain.",
    "Upstox candles have no independently verified corporate-action adjustment history. Feature windows after known large discontinuities are excluded; future discontinuities remain in evaluation and may reflect splits, dividends or genuine crashes. Raw-price returns may be economically incorrect around corporate actions.",
    "Historical news ablation is unavailable until timestamped, revision-safe historical coverage is independently verified. No Gemini-derived historical features are used.",
    "Daily bars cannot prove next-open execution or model spreads, circuit limits, liquidity and market impact. Costs below are explicit research assumptions.",
    "Cross-sectional observations and overlapping labels are dependent; uncertainty uses date-block resampling rather than independent-row confidence intervals.",
    "Evaluation requires complete future observations; unavailable labels are unscorable and reported. Future large price jumps are retained, not censored. Missing observations may still introduce selection bias. This is not deployment qualification.",
]


def experiment_identity(data_hash):
    """Source and explicit protocol changes cannot overwrite evaluated artifacts."""
    source_hash = hashlib.sha256(Path(__file__).read_bytes() + Path(__file__).with_name("news_features.py").read_bytes()).hexdigest()
    protocol = {"seed": SEED, "horizons": HORIZONS, "features": FEATURES,
                "candidates": ["logistic", "catboost_4", "catboost_6"], "version": VERSION}
    digest = hashlib.sha256(json.dumps({"data": data_hash, "source": source_hash, "protocol": protocol}, sort_keys=True).encode()).hexdigest()
    return digest, source_hash


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, allow_nan=False, default=str), encoding="utf-8")
    os.replace(temp, path)


def load_candles(data_dir):
    """Validate provider provenance and OHLC consistency without inventing rows."""
    frames, metadata, quality = {}, {}, {}
    digest = hashlib.sha256(VERSION.encode())
    today = pd.Timestamp(datetime.now(timezone(timedelta(hours=5, minutes=30))).date())
    for path in sorted((Path(data_dir) / "candles").glob("*.json")):
        raw = path.read_bytes()
        obj = json.loads(raw)
        if obj.get("source") != "upstox-v3":
            raise ValueError(f"{path.name}: real Upstox V3 provenance is required")
        symbol = obj["symbol"]
        rows = obj.get("candles", [])
        if not rows:
            quality[symbol] = {"inputRows": 0, "validRows": 0}
            continue
        frame = pd.DataFrame([row[:7] + [None] * max(0, 7-len(row)) for row in rows],
                             columns=["timestamp", "open", "high", "low", "close", "volume", "oi"])
        # Provider timestamps carry exchange offset. UTC conversion would shift
        # midnight bars to the preceding date; preserve the exchange-local date.
        frame["date"] = pd.to_datetime(frame.timestamp.astype(str).str.slice(0, 10), errors="coerce")
        for column in ["open", "high", "low", "close", "volume"]:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
        valid = (np.isfinite(frame[["open", "high", "low", "close", "volume"]]).all(axis=1)
                 & (frame[["open", "high", "low", "close"]] > 0).all(axis=1)
                 & (frame.volume >= 0) & (frame.high >= frame[["open", "close", "low"]].max(axis=1))
                 & (frame.low <= frame[["open", "close", "high"]].min(axis=1))
                 & frame.date.notna() & (frame.date < today))
        invalid_count = int((~valid).sum())
        frame = frame.loc[valid].copy()
        duplicate = frame.duplicated("date", keep=False)
        duplicate_dates = int(frame.loc[duplicate, "date"].nunique())
        # Conflicting observations are not resolved by picking a convenient price.
        conflict_dates = []
        for date, group in frame.loc[duplicate].groupby("date"):
            if len(group[["open", "high", "low", "close", "volume"]].drop_duplicates()) > 1:
                conflict_dates.append(date)
        frame = frame.loc[~frame.date.isin(conflict_dates)].drop_duplicates("date").set_index("date").sort_index()
        frames[symbol] = frame
        digest.update(json.dumps({"symbol": symbol, "instrumentKey": obj.get("instrumentKey"),
                                  "benchmark": obj.get("benchmark"), "exchange": obj.get("exchange"),
                                  "data": frame[["open", "high", "low", "close", "volume"]].to_json(date_format="iso")}, sort_keys=True).encode())
        metadata[symbol] = {k: obj.get(k) for k in ["symbol", "instrumentKey", "exchange", "benchmark", "source", "fetchedAt", "sector", "isin"]}
        quality[symbol] = {"inputRows": len(rows), "validRows": len(frame), "invalidOrIncompleteRows": invalid_count,
                           "duplicateDates": duplicate_dates, "conflictingDatesExcluded": len(conflict_dates)}
    if not frames:
        raise ValueError("No valid provider candles found in data-dir/candles")
    return frames, metadata, quality, digest.hexdigest()


def make_features(frame, benchmark=None):
    """Each feature at t uses bars at or before t; gaps remain NaN."""
    f = frame.copy()
    c, o, v = f.close, f.open, f.volume
    r = c.pct_change(fill_method=None)
    jump = ((o / c.shift(1) - 1).abs() > .35) | (r.abs() > .40)
    f["discontinuity"] = jump
    for n in (1, 5, 20, 60):
        f[f"return{n}"] = c / c.shift(n) - 1
    f["volatility5"] = r.rolling(5).std()
    f["volatility20"] = r.rolling(20).std()
    f["range"] = (f.high - f.low) / c
    f["body"] = (c - o) / o
    f["overnight"] = o / c.shift(1) - 1
    f["volume_ratio"] = v / v.rolling(20).mean().replace(0, np.nan)
    f["volume_change"] = v / v.shift(1).replace(0, np.nan) - 1
    for n in (20, 60):
        f[f"distance{n}"] = c / c.rolling(n).mean() - 1
    if benchmark is not None:
        bc = benchmark.close.reindex(f.index)
        f["benchmark_return5"] = bc / bc.shift(5) - 1
        f["benchmark_return20"] = bc / bc.shift(20) - 1
        f["benchmark_volatility20"] = bc.pct_change(fill_method=None).rolling(20).std()
    else:
        for col in ["benchmark_return5", "benchmark_return20", "benchmark_volatility20"]:
            f[col] = np.nan
    f["relative_return20"] = f.return20 - f.benchmark_return20
    # A full 61-row uninterrupted window is needed for the longest lag.
    f["featuresEligible"] = (c.rolling(61).count() == 61) & ~jump.rolling(61, min_periods=1).max().astype(bool)
    f[FEATURES] = f[FEATURES].replace([np.inf, -np.inf], np.nan)
    return f


def make_dataset(frames, metadata, horizon):
    benchmarks = {s: f for s, f in frames.items() if metadata[s].get("benchmark")}
    if not benchmarks:
        raise ValueError("A real benchmark history is required to define trading sessions")
    all_dates = pd.DatetimeIndex(sorted(set().union(*(set(f.index) for f in benchmarks.values()))))
    chunks, latest, excluded = [], [], {}
    for symbol, raw in frames.items():
        if metadata[symbol].get("benchmark"):
            continue
        name = "SENSEX" if metadata[symbol].get("exchange") == "BSE" else "NIFTY_50"
        benchmark = benchmarks.get(name, next(iter(benchmarks.values())))
        frame = raw.reindex(all_dates[(all_dates >= raw.index.min()) & (all_dates <= all_dates.max())])
        f = make_features(frame, benchmark)
        f["symbol"] = symbol
        f["date"] = f.index
        f["entryDate"] = pd.Series(f.index, index=f.index).shift(-1)
        f["labelEnd"] = pd.Series(f.index, index=f.index).shift(-horizon)
        f["forwardReturn"] = f.close.shift(-horizon) / f.open.shift(-1) - 1
        future_bad = pd.concat([f.discontinuity.astype("boolean").shift(-n) for n in range(1, horizon+1)], axis=1).fillna(True).any(axis=1)
        future_missing = pd.concat([f.close.shift(-n).isna() for n in range(1, horizon+1)], axis=1).any(axis=1)
        complete_future = f.labelEnd.notna()
        # Future jumps are diagnostic ONLY. Removing them would exclude real
        # crashes using information unavailable at the prediction timestamp.
        f["futureDiscontinuity"] = future_bad & complete_future
        eligible = f.featuresEligible & ~future_missing & f.forwardReturn.notna() & f.entryDate.notna()
        f["target"] = (f.forwardReturn > 0).astype(int)
        excluded[symbol] = {"discontinuities": int(f.discontinuity.sum()), "featureWindowExcluded": int((~f.featuresEligible).sum()),
                            "missingSessions": int(f.close.isna().sum()), "labelOrFutureWindowExcluded": int(future_missing.sum()),
                            "pastEligibleWithMatureLabels": int((f.featuresEligible & complete_future).sum()),
                            "futureDiscontinuityRetained": int((eligible & future_bad).sum()),
                            "futureMissingExcluded": int((f.featuresEligible & complete_future & future_missing).sum()),
                            "trainingRows": int(eligible.sum())}
        chunks.append(f.loc[eligible, FEATURES + ["symbol", "date", "entryDate", "labelEnd", "forwardReturn", "target", "futureDiscontinuity"]])
        if len(f) and bool(f.iloc[-1].featuresEligible) and pd.notna(f.iloc[-1].close):
            latest.append(f.iloc[[-1]][FEATURES + ["symbol", "date"]])
    if not chunks:
        raise ValueError("No stock candles available")
    dataset = pd.concat(chunks).sort_values(["date", "symbol"]).reset_index(drop=True)
    last = pd.concat(latest).reset_index(drop=True) if latest else pd.DataFrame(columns=FEATURES+["symbol", "date"])
    return dataset, last, excluded


def purged_split(frame, validation_start, validation_end=None):
    train = frame.loc[(frame.date < validation_start) & (frame.labelEnd < validation_start)]
    valid = frame.loc[frame.date >= validation_start]
    if validation_end is not None:
        valid = valid.loc[(valid.date < validation_end) & (valid.labelEnd < validation_end)]
    return train, valid


def score(y, p):
    y, p = np.asarray(y), np.clip(np.asarray(p), 1e-6, 1-1e-6)
    return {"accuracy": float(accuracy_score(y, p >= .5)),
            "auc": float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None,
            "brier": float(brier_score_loss(y, p)), "logLoss": float(log_loss(y, p, labels=[0, 1])),
            "samples": len(y), "upRate": float(y.mean())}


def build_model(name):
    if name == "logistic":
        return make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True), StandardScaler(),
                             LogisticRegression(C=.1, max_iter=500, random_state=SEED))
    from catboost import CatBoostClassifier
    depth = int(name.rsplit("_", 1)[1])
    return CatBoostClassifier(iterations=220, depth=depth, learning_rate=.035, l2_leaf_reg=8,
                              loss_function="Logloss", random_seed=SEED, thread_count=4,
                              verbose=False, allow_writing_files=False, nan_mode="Min")


def positive_prob(model, frame, features=None):
    return model.predict_proba(frame[features or FEATURES])[:, 1]


def logit(p):
    p = np.clip(p, 1e-6, 1-1e-6)
    return np.log(p / (1-p)).reshape(-1, 1)


def calibrated_prob(model, calibrator, frame, features=None):
    raw = positive_prob(model, frame, features)
    return calibrator.predict_proba(logit(raw))[:, 1] if calibrator is not None else raw


def block_accuracy_ci(frame, p, horizon, repetitions=300):
    """Bootstrap contiguous date blocks so correlated stock rows stay together."""
    daily = pd.DataFrame({"date": frame.date.to_numpy(), "correct": ((np.asarray(p) >= .5) == frame.target.to_numpy()).astype(int)})
    grouped = daily.groupby("date").correct.agg(["sum", "count"]).to_numpy()
    n = len(grouped)
    if n < 2:
        return None
    rng = np.random.default_rng(SEED)
    block = min(max(20, horizon), n)
    outcomes = []
    for _ in range(repetitions):
        ids = np.concatenate([np.arange(start, start+block) % n for start in rng.integers(0, n, math.ceil(n/block))])[:n]
        sample = grouped[ids]
        outcomes.append(float(sample[:, 0].sum() / sample[:, 1].sum()))
    lo, hi = np.quantile(outcomes, [.025, .975])
    return {"lower": float(lo), "upper": float(hi), "confidence": .95, "method": "circular date-block bootstrap",
            "blockSessions": block, "resamples": repetitions}


def signal_stats(frame, p, threshold=.6):
    p, y = np.asarray(p), frame.target.to_numpy()
    up, down = p >= threshold, p <= 1-threshold
    return {"threshold": threshold, "coverage": float((up | down).mean()),
            "upSignals": int(up.sum()), "downSignals": int(down.sum()),
            "upPrecision": float(y[up].mean()) if up.any() else None,
            "downPrecision": float((1-y[down]).mean()) if down.any() else None}


def backtest(frame, p, horizon, cost_bps=20):
    """Long-only equal-weight cohorts, cash otherwise. No overlapping cohorts.

    Marks equity only at cohort exits: this is NOT daily mark-to-market drawdown.
    Costs are round-trip basis points per invested amount.
    """
    data = frame.copy()
    data["probability"] = p
    dates = sorted(data.date.unique())
    cohorts, next_allowed, equity, peak, max_dd = [], None, 1., 1., 0.
    for date in dates:
        if next_allowed is not None and date <= next_allowed:
            continue
        rows = data.loc[data.date == date]
        end = rows.labelEnd.max()
        next_allowed = end
        picks = rows.loc[rows.probability >= .6]
        gross = float(picks.forwardReturn.mean()) if len(picks) else 0.
        net = gross - cost_bps/10000 if len(picks) else 0.
        equal_universe = float(rows.forwardReturn.mean()) - cost_bps/10000
        equity *= 1+net
        peak = max(peak, equity)
        max_dd = min(max_dd, equity/peak-1)
        cohorts.append({"signalDate": pd.Timestamp(date).date().isoformat(), "entryDate": rows.entryDate.min().date().isoformat(),
                        "exitDate": end.date().isoformat(), "positions": len(picks), "netReturn": net,
                        "equalUniverseNetReturn": equal_universe, "equity": equity})
    benchmark_return = float(np.prod([1+c["equalUniverseNetReturn"] for c in cohorts])-1) if cohorts else None
    return {"strategy": "Long equal-weight stocks with probability >= 0.60; otherwise cash; non-overlapping cohorts",
            "roundTripCostBps": cost_bps, "totalReturn": equity-1, "equalUniverseTotalReturn": benchmark_return,
            "maxDrawdownAtCohortExits": max_dd, "drawdownLimitation": "Cohort-exit marks understate possible intraperiod drawdown",
            "cohorts": cohorts, "investedCohorts": sum(c["positions"] > 0 for c in cohorts)}


def walk_forward_experiments(frame, features=None):
    features = features or FEATURES
    dates = np.array(sorted(frame.date.unique()))
    edges = [int(len(dates)*fraction) for fraction in (.45, .63, .81)] + [len(dates)]
    results = []
    for name in ["logistic", "catboost_4", "catboost_6"]:
        folds = []
        for i in range(3):
            start = dates[edges[i]]
            end = dates[edges[i+1]] if edges[i+1] < len(dates) else pd.Timestamp(dates[-1]) + pd.Timedelta(days=1)
            train, valid = purged_split(frame, start, end)
            if train.date.nunique() < 90 or valid.date.nunique() < 15 or train.target.nunique() < 2 or len(valid) < 30:
                continue
            model = build_model(name)
            model.fit(train[features], train.target)
            metrics = score(valid.target, positive_prob(model, valid, features))
            folds.append({"trainStart": train.date.min().date().isoformat(), "trainEnd": train.date.max().date().isoformat(),
                          "maxTrainingLabelDate": train.labelEnd.max().date().isoformat(), "validationStart": pd.Timestamp(start).date().isoformat(),
                          "validationEnd": valid.date.max().date().isoformat(), "trainingSamples": len(train), **metrics})
        if len(folds) < 2:
            raise ValueError("Insufficient chronological history for two valid walk-forward folds")
        results.append({"model": name, "folds": folds,
                        "meanLogLoss": float(np.average([f["logLoss"] for f in folds], weights=[f["samples"] for f in folds])),
                        "meanAccuracy": float(np.average([f["accuracy"] for f in folds], weights=[f["samples"] for f in folds]))})
    return results


def train_horizon(dataset, horizon, artifact_dir, features=None):
    features = features or FEATURES
    dates = np.array(sorted(dataset.date.unique()))
    if len(dates) < 450 or len(dataset) < 1000:
        raise ValueError(f"Horizon {horizon}: at least 450 eligible dates and 1,000 stock-date observations required")
    test_start = dates[int(len(dates)*.8)]
    development, test = purged_split(dataset, test_start)
    dev_dates = np.array(sorted(development.date.unique()))
    calibration_start = dev_dates[int(len(dev_dates)*.85)]
    training, calibration = purged_split(development, calibration_start)
    experiments = walk_forward_experiments(training, features)
    selected = min(experiments, key=lambda row: row["meanLogLoss"])["model"]
    model = build_model(selected)
    model.fit(training[features], training.target)
    calibrator = None
    if calibration.target.nunique() == 2 and calibration.date.nunique() >= 30:
        calibrator = LogisticRegression(C=1., random_state=SEED)
        calibrator.fit(logit(positive_prob(model, calibration, features)), calibration.target)
    p = calibrated_prob(model, calibrator, test, features)
    logistic = build_model("logistic")
    logistic.fit(training[features], training.target)
    rate = float(training.target.mean())
    momentum = np.where(test.return20 >= 0, .55, .45)
    metrics = score(test.target, p)
    metrics["accuracyConfidenceInterval"] = block_accuracy_ci(test, p, horizon)
    majority = np.repeat(rate, len(test))
    artifact = {"model": model, "calibrator": calibrator, "features": features, "horizon": horizon,
                "trainedThrough": training.date.max().date().isoformat(), "calibratedThrough": calibration.date.max().date().isoformat(),
                "selectedModel": selected, "version": VERSION}
    joblib.dump(artifact, artifact_dir / f"horizon-{horizon}.joblib")
    test_out = test[["symbol", "date", "entryDate", "labelEnd", "target", "forwardReturn", "futureDiscontinuity"]].copy()
    test_out["probabilityUp"] = p
    test_out.to_csv(artifact_dir / f"holdout-{horizon}.csv", index=False)
    result = {"horizon": horizon, "unit": "trading sessions", "target": "Next-session open to horizon-session close return > 0",
              "selectedModel": selected, "selectionMetric": "Purged walk-forward validation log loss before calibration and holdout",
              "validation": experiments, "calibration": {"method": "sigmoid" if calibrator else "none", "samples": len(calibration),
                  "start": calibration.date.min().date().isoformat(), "end": calibration.date.max().date().isoformat()},
              "training": {"start": training.date.min().date().isoformat(), "end": training.date.max().date().isoformat(), "samples": len(training)},
              "holdout": {"start": test.date.min().date().isoformat(), "end": test.date.max().date().isoformat(),
                  "sessions": int(test.date.nunique()), "futureDiscontinuityRowsRetained": int(test.futureDiscontinuity.sum()), **metrics},
              "baselines": {"trainingMajority": score(test.target, majority), "momentum20": score(test.target, momentum),
                            "logistic": score(test.target, positive_prob(logistic, test, features))},
              "strongSignals": signal_stats(test, p), "backtest": backtest(test, p, horizon),
              "costSensitivity": [{"roundTripCostBps": cost, "totalReturn": backtest(test, p, horizon, cost)["totalReturn"]} for cost in [10, 20, 40]],
              "newsAblation": {"status": "unavailable", "reason": "No verified point-in-time historical news training dataset"}}
    result["beatsMajorityAccuracy"] = metrics["accuracy"] > result["baselines"]["trainingMajority"]["accuracy"]
    result["beatsMajorityLogLoss"] = metrics["logLoss"] < result["baselines"]["trainingMajority"]["logLoss"]
    result["meets90PercentAccuracy"] = metrics["accuracy"] >= .9
    return result


def infer(data_dir, report=None):
    root = Path(data_dir)
    report = report or json.loads((root / "reports" / "latest.json").read_text(encoding="utf-8"))
    frames, meta, quality, data_hash = load_candles(root)
    version = report["modelVersion"]
    artifact_dir = root / "models" / version
    rows = []
    for horizon in HORIZONS:
        artifact = joblib.load(artifact_dir / f"horizon-{horizon}.joblib")
        _, latest, _ = make_dataset(frames, meta, horizon)
        if latest.empty:
            continue
        p = calibrated_prob(artifact["model"], artifact["calibrator"], latest)
        for (_, row), probability in zip(latest.iterrows(), p):
            rows.append({"symbol": row.symbol, "horizon": horizon, "asOf": row.date.date().isoformat(),
                         "probabilityUp": float(probability), "signal": "up" if probability >= .6 else "down" if probability <= .4 else "uncertain",
                         "model": artifact["selectedModel"], "experimental": True,
                         "calibration": "sigmoid" if artifact["calibrator"] is not None else "uncalibrated",
                         "trainedThrough": artifact["trainedThrough"], "calibratedThrough": artifact["calibratedThrough"],
                         "features": {key: float(row[key]) if pd.notna(row[key]) else None for key in FEATURES}})
    result = {"generatedAt": utcnow(), "modelVersion": version, "status": "experimental", "dataHash": data_hash,
              "target": "Positive return from next-session open to horizon-session close", "predictions": rows,
              "limitations": LIMITATIONS, "newsUsedInPrediction": False}
    atomic_json(root / "predictions.json", result)
    return result


def train(data_dir):
    root = Path(data_dir)
    frames, meta, quality, digest = load_candles(root)
    experiment_hash, source_hash = experiment_identity(digest)
    model_version = f"{VERSION}-{experiment_hash[:16]}"
    artifact_dir = root / "models" / model_version
    existing = artifact_dir / "report.json"
    if existing.exists():
        report = json.loads(existing.read_text(encoding="utf-8"))
        atomic_json(root / "reports" / "latest.json", report)
        infer(root, report)
        return report
    artifact_dir.mkdir(parents=True, exist_ok=True)
    results, exclusions = [], {}
    from ml.news_features import load_events, news_ablation
    events = load_events(root)
    for horizon in HORIZONS:
        print(f"Building and evaluating horizon {horizon}...", flush=True)
        dataset, _, excluded = make_dataset(frames, meta, horizon)
        result = train_horizon(dataset, horizon, artifact_dir)
        result["newsAblation"] = news_ablation(dataset, events, horizon, artifact_dir, train_horizon)
        results.append(result)
        exclusions[str(horizon)] = excluded
    report = {"generatedAt": utcnow(), "status": "experimental", "modelVersion": model_version,
              "dataHash": digest, "seed": SEED, "pipelineVersion": VERSION,
              "experimentHash": experiment_hash, "sourceCodeHash": source_hash,
              "universe": [s for s in sorted(frames) if not meta[s].get("benchmark")],
              "benchmarks": [s for s in sorted(frames) if meta[s].get("benchmark")],
              "source": "Upstox Historical Candle Data V3", "quality": quality, "exclusions": exclusions,
              "horizons": results, "limitations": LIMITATIONS,
              "environment": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "sklearn": sklearn.__version__, "catboost": __import__("catboost").__version__},
              "protocol": {"split": "Earliest 80% of eligible dates development; final 20% sealed holdout",
                  "purge": "Training label end strictly before the next split start, including calibration and every validation fold",
                  "candidateBudget": ["logistic", "catboost_4", "catboost_6"], "walkForwardFolds": 3,
                  "calibration": "Last 15% of development dates; never holdout", "finalHoldoutEvaluationsPerCandidateSelection": 1,
                  "modelRefitAfterHoldout": False, "syntheticTrainingData": False,
                  "operationalNote": "Saved model deliberately remains trained before the sealed evaluation period. Inference uses that same evaluated artifact."}}
    atomic_json(existing, report)
    atomic_json(root / "reports" / "latest.json", report)
    infer(root, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["train", "infer"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    try:
        result = train(args.data_dir) if args.command == "train" else infer(args.data_dir)
        print(json.dumps({"status": result["status"], "modelVersion": result["modelVersion"],
                          "report": str(Path(args.data_dir) / "reports" / "latest.json")}, indent=2))
    except Exception as error:
        failure = {"generatedAt": utcnow(), "status": "failed", "error": str(error)}
        atomic_json(Path(args.data_dir) / "reports" / "last-error.json", failure)
        raise


if __name__ == "__main__":
    main()
