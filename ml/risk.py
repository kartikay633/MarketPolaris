"""Volatility-regime risk research engine (pulse-risk-v1).

Run: python -m ml.risk {train,infer,score-forward} --data-dir data/pulse

Question: after a completed NSE session, will a stock's realised volatility over
the next 20 sessions (daily close-to-close returns t+1..t+20) exceed its own
normal level, defined as the median 20-session volatility over the trailing 252
sessions (known at t)? Protocol, fixed in code before results are inspected and
matching pulse-rank-v2:

* Same universe, causal feature panel and corporate-event exclusions as ml.rank.
* Earliest 80% of label-eligible dates are development; final 20% is a holdout
  evaluated once. Four expanding, purged walk-forward folds select one
  candidate by mean validation ROC AUC (probability ranking quality; calibration
  is a separate step, the lesson recorded in pulse-rank-v2).
* Candidates: volatility persistence (current vs normal volatility only),
  logistic regression, histogram gradient boosting, their ensemble.
* Sigmoid calibration on development out-of-fold predictions only.
* Primary holdout: refit every 63 sessions on matured labels; secondary: frozen.
* Risk tiers use fixed thresholds: elevated >= 0.65, calm <= 0.35.
* Production predictions refit on all matured labels and go to a write-once
  forward ledger.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ml.pulse import atomic_json, load_candles, utcnow
from ml.rank import (CALENDAR, CORPORATE_EVENTS, FEATURES as RANK_FEATURES, REFIT_EVERY, SEED,
                     accuracy_ci, build_panel, classification, logit, calibrate, reliability, selective,
                     split_dates)

VERSION = "pulse-risk-v1"
HORIZON = 20
NORMAL_WINDOW = 252
ELEVATED, CALM = .65, .35
RAW = ["raw_vol_20", "raw_vol_60", "raw_downside_vol_60", "raw_idio_vol_60", "raw_range_20", "raw_max_ret_20", "raw_beta_120"]
FEATURES = RANK_FEATURES + RAW + ["vol_vs_normal", "vol60_vs_normal"]
CANDIDATES = ["persistence", "logistic", "gbm", "ensemble"]
TARGET = ("Realised volatility of daily close-to-close returns over the next 20 sessions above the stock's "
          "median 20-session volatility of the trailing 252 sessions")
LIMITATIONS = [
    "Experimental research. Volatility forecasts describe risk, not price direction or expected return.",
    "Universe is today's liquid large/mid caps; survivorship bias applies.",
    "Volatility uses daily closes; intraday swings, gaps inside the day and circuit limits are not measured.",
    "Scheduled events (results, policy meetings) are not explicit features; their effect enters only through price history.",
    "Rows on the same date and overlapping 20-session labels are dependent; accuracy intervals use date-block bootstrap.",
    "The holdout period overlaps dates already examined by a one-off exploratory probe of a similar volatility target before this protocol was written; the forward ledger is the untouched test.",
]


def experiment_identity(data_hash):
    here = Path(__file__)
    source = here.read_bytes() + here.with_name("rank.py").read_bytes() + here.with_name("pulse.py").read_bytes()
    protocol = {"seed": SEED, "horizon": HORIZON, "features": FEATURES, "candidates": CANDIDATES,
                "events": CORPORATE_EVENTS, "refit": REFIT_EVERY, "tiers": [ELEVATED, CALM], "version": VERSION}
    return hashlib.sha256(json.dumps({"data": data_hash, "source": hashlib.sha256(source).hexdigest(),
                                      "protocol": protocol}, sort_keys=True).encode()).hexdigest()


def risk_panel(frames, meta):
    """ml.rank panel plus the volatility label and its causal reference level."""
    long = build_panel(frames, meta)
    cal = frames[CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    close = pd.DataFrame({s: frames[s].close.reindex(cal) for s in stocks})
    r = close.pct_change(fill_method=None)
    vol20 = r.rolling(20, min_periods=18).std()
    normal = vol20.rolling(NORMAL_WINDOW, min_periods=200).median()
    future = vol20.shift(-HORIZON)  # std of returns t+1..t+20
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    pick = lambda frame: frame.stack(future_stack=True).reindex(idx).to_numpy()
    long["normal_vol"], long["future_vol"] = pick(normal), pick(future)
    long["vol_vs_normal"] = long.raw_vol_20 / long.normal_vol
    long["vol60_vs_normal"] = long.raw_vol_60 / long.normal_vol
    long[["vol_vs_normal", "vol60_vs_normal"]] = long[["vol_vs_normal", "vol60_vs_normal"]].replace([np.inf, -np.inf], np.nan)
    return long


def risk_frame(long):
    # fwd_20 is defined only for complete future paths without excluded corporate events.
    d = long.loc[long.fwd_20.notna() & long.future_vol.notna() & long.normal_vol.notna()].copy()
    d["labelEnd"] = pd.to_datetime(d.labelEnd_20)
    d["y"] = (d.future_vol > d.normal_vol).astype(int)
    d["future_vs_normal"] = d.future_vol / d.normal_vol
    return d.sort_values(["date", "symbol"]).reset_index(drop=True)


def fit(name, train):
    y = train.y.to_numpy()
    if name == "persistence":
        x = np.log(train[["vol_vs_normal"]]).fillna(0)
        return {"kind": "persistence", "model": LogisticRegression(C=1., max_iter=500).fit(x, y)}
    models = {}
    if name in ("logistic", "ensemble"):
        models["logistic"] = make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True), StandardScaler(),
                                           LogisticRegression(C=.05, max_iter=1000)).fit(train[FEATURES], y)
    if name in ("gbm", "ensemble"):
        models["gbm"] = HistGradientBoostingClassifier(max_iter=300, learning_rate=.05, max_leaf_nodes=31,
                                                       min_samples_leaf=500, l2_regularization=1., max_features=.5,
                                                       early_stopping=False, random_state=SEED).fit(train[FEATURES], y)
    return {"kind": "model", "models": models}


def predict(fitted, frame):
    if fitted["kind"] == "persistence":
        return fitted["model"].predict_proba(np.log(frame[["vol_vs_normal"]]).fillna(0))[:, 1]
    return np.mean([m.predict_proba(frame[FEATURES])[:, 1] for m in fitted["models"].values()], axis=0)


def auc(y, p):
    return float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None


def evaluate(d, p):
    out = classification(d.y, p)
    out["accuracyConfidenceInterval"] = accuracy_ci(d.rename(columns={"y": "y_risk"}), p, "risk", HORIZON)
    out["start"], out["end"], out["sessions"] = d.date.min().date().isoformat(), d.date.max().date().isoformat(), int(d.date.nunique())
    return out


def tiers(d, p):
    """Outcome of the fixed elevated/calm thresholds on the evaluated rows."""
    p = np.asarray(p)
    out = {}
    for name, mask, hit in (("elevated", p >= ELEVATED, 1), ("calm", p <= CALM, 0)):
        rows = d.loc[mask]
        out[name] = {"threshold": ELEVATED if name == "elevated" else CALM, "share": float(mask.mean()), "samples": int(mask.sum()),
                     "precision": float((rows.y == hit).mean()) if len(rows) else None,
                     "medianFutureVsNormal": float(rows.future_vs_normal.median()) if len(rows) else None}
    out["allRowsMedianFutureVsNormal"] = float(d.future_vs_normal.median())
    return out


def regimes(d, p):
    frame = pd.DataFrame({"y": d.y.to_numpy(), "p": np.asarray(p), "date": d.date.to_numpy(), "year": d.date.dt.year.to_numpy(),
                          "trend": np.where(d.mkt_trend_200 >= 0, "NIFTY above 200-day average", "NIFTY below 200-day average")})
    out = {}
    for key in ("year", "trend"):
        out[key] = [{"group": str(k), "accuracy": float(((g.p >= .5) == g.y).mean()), "auc": auc(g.y, g.p),
                     "positiveRate": float(g.y.mean()), "sessions": int(g.date.nunique()), "samples": int(len(g))}
                    for k, g in frame.groupby(key)]
    return out


def train(data_dir):
    root = Path(data_dir)
    frames, meta, quality, data_hash = load_candles(root)
    version = f"{VERSION}-{experiment_identity(data_hash)[:16]}"
    artifact_dir = root / "models" / version
    existing = artifact_dir / "report.json"
    if existing.exists():
        report = json.loads(existing.read_text(encoding="utf-8"))
        atomic_json(root / "reports" / "risk-latest.json", report)
        infer(root, report)
        return report
    artifact_dir.mkdir(parents=True, exist_ok=True)
    print("Building risk panel...", flush=True)
    d = risk_frame(risk_panel(frames, meta))
    print(f"Risk: {len(d):,} rows, {d.date.nunique()} sessions, {d.symbol.nunique()} stocks, positive rate {d.y.mean():.3f}", flush=True)
    dev, holdout, starts = split_dates(d)
    validation, oof = [], {}
    for name in CANDIDATES:
        folds, preds = [], []
        for start, end in zip(starts[:-1], starts[1:]):
            tr = dev.loc[dev.labelEnd < start]
            va = dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
            p = predict(fit(name, tr), va)
            folds.append({"trainEnd": tr.date.max().date().isoformat(), "validationStart": va.date.min().date().isoformat(),
                          "validationEnd": va.date.max().date().isoformat(), "trainingSamples": int(len(tr)),
                          **classification(va.y, p), "auc": auc(va.y, p)})
            preds.append(pd.Series(p, index=va.index))
        w = [f["samples"] for f in folds]
        validation.append({"model": name, "folds": folds, "meanAUC": float(np.mean([f["auc"] for f in folds])),
                           "meanAccuracy": float(np.average([f["accuracy"] for f in folds], weights=w)),
                           "meanLogLoss": float(np.average([f["logLoss"] for f in folds], weights=w))})
        oof[name] = pd.concat(preds)
        print(f"  {name:<12} auc={validation[-1]['meanAUC']:.4f} acc={validation[-1]['meanAccuracy']:.4f} logloss={validation[-1]['meanLogLoss']:.4f}", flush=True)
    selected = max(validation, key=lambda r: r["meanAUC"])["model"]
    oof_rows = dev.loc[oof[selected].index]
    calibrator = LogisticRegression(C=1.).fit(logit(oof[selected].to_numpy()), oof_rows.y)
    dev_p = calibrate(calibrator, oof[selected].to_numpy())

    dates = np.array(sorted(holdout.date.unique()))
    parts, refits = [], []
    for i in range(0, len(dates), REFIT_EVERY):
        start = dates[i]
        end = dates[i + REFIT_EVERY] if i + REFIT_EVERY < len(dates) else None
        tr = d.loc[d.labelEnd < start]
        block = holdout.loc[(holdout.date >= start) & ((holdout.date < end) if end is not None else True)]
        parts.append(pd.Series(predict(fit(selected, tr), block), index=block.index))
        refits.append({"refitDate": pd.Timestamp(start).date().isoformat(), "trainedThrough": tr.date.max().date().isoformat(),
                       "maxLabelDate": tr.labelEnd.max().date().isoformat(), "predictedRows": int(len(block))})
    p = calibrate(calibrator, pd.concat(parts).reindex(holdout.index).to_numpy())
    p_frozen = calibrate(calibrator, predict(fit(selected, dev), holdout))
    rule = (holdout.vol_vs_normal > 1).astype(float).to_numpy()
    base_rate = float(dev.y.mean())
    primary = evaluate(holdout, p)
    primary["auc"] = auc(holdout.y, p)
    report = {"generatedAt": utcnow(), "status": "experimental", "modelVersion": version, "pipelineVersion": VERSION,
              "dataHash": data_hash, "seed": SEED, "horizon": HORIZON, "unit": "trading sessions", "target": TARGET,
              "selectedModel": selected, "selectionMetric": "Mean purged walk-forward validation ROC AUC (development only)",
              "validation": validation,
              "development": {"start": dev.date.min().date().isoformat(), "end": dev.date.max().date().isoformat(),
                              "samples": int(len(dev)), "sessions": int(dev.date.nunique()), "positiveRate": base_rate},
              "calibration": {"method": "sigmoid on development out-of-fold predictions", "samples": int(len(oof_rows)),
                              "reliabilityDevelopment": reliability(oof_rows.y, dev_p)},
              "holdout": primary, "holdoutFrozen": {**evaluate(holdout, p_frozen), "auc": auc(holdout.y, p_frozen)}, "refits": refits,
              "baselines": {"trainingRate": classification(holdout.y, np.repeat(base_rate, len(holdout))),
                            "persistenceRule": {"description": "High if current 20-session volatility exceeds its normal level",
                                                "accuracy": float((rule == holdout.y.to_numpy()).mean()), "samples": int(len(holdout))}},
              "selectiveDevelopment": selective(oof_rows.y.to_numpy(), dev_p), "selectiveHoldout": selective(holdout.y.to_numpy(), p),
              "reliabilityHoldout": reliability(holdout.y, p), "tiersHoldout": tiers(holdout, p), "tiersDevelopment": tiers(oof_rows, dev_p),
              "regimes": regimes(holdout, p),
              "meets90PercentAccuracy": primary["accuracy"] >= .9,
              "beatsPersistenceRule": primary["accuracy"] > float((rule == holdout.y.to_numpy()).mean()),
              "features": FEATURES, "limitations": LIMITATIONS,
              "protocol": {"split": "Earliest 80% of label-eligible dates for development; final 20% holdout evaluated once",
                           "folds": "Four expanding walk-forward folds; training labels end before each validation start",
                           "candidates": CANDIDATES, "selection": "Highest mean validation ROC AUC",
                           "calibration": "Sigmoid fitted on development out-of-fold predictions",
                           "holdoutPrimary": f"Refit every {REFIT_EVERY} sessions on matured labels only",
                           "holdoutSecondary": "Single model frozen at the end of development",
                           "tiers": f"Elevated >= {ELEVATED}, calm <= {CALM}; fixed before evaluation"},
              "environment": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "sklearn": sklearn.__version__}}
    out = holdout[["symbol", "date", "labelEnd", "future_vol", "normal_vol", "y"]].copy()
    out["probability"] = p
    out.to_csv(artifact_dir / "holdout-risk.csv", index=False)
    joblib.dump({"calibrator": calibrator, "selected": selected}, artifact_dir / "calibrator-risk.joblib")
    atomic_json(existing, report)
    atomic_json(root / "reports" / "risk-latest.json", report)
    infer(root, report)
    return report


def infer(data_dir, report=None):
    root = Path(data_dir)
    report = report or json.loads((root / "reports" / "risk-latest.json").read_text(encoding="utf-8"))
    frames, meta, _, data_hash = load_candles(root)
    long = risk_panel(frames, meta)
    as_of = long.date.max()
    latest = long.loc[long.date == as_of].reset_index(drop=True)
    d = risk_frame(long)
    saved = joblib.load(root / "models" / report["modelVersion"] / "calibrator-risk.joblib")
    p = calibrate(saved["calibrator"], predict(fit(saved["selected"], d), latest))
    annual = np.sqrt(252)
    rows = []
    for (_, row), prob in zip(latest.iterrows(), p):
        tier = "elevated" if prob >= ELEVATED else "calm" if prob <= CALM else "normal"
        rows.append({"symbol": row.symbol, "sector": row.sector, "asOf": as_of.date().isoformat(), "horizon": HORIZON,
                     "probabilityHighVolatility": float(prob), "riskTier": tier,
                     "currentVolatilityAnnualised": float(row.raw_vol_20 * annual) if pd.notna(row.raw_vol_20) else None,
                     "normalVolatilityAnnualised": float(row.normal_vol * annual) if pd.notna(row.normal_vol) else None,
                     "currentVsNormal": float(row.vol_vs_normal) if pd.notna(row.vol_vs_normal) else None,
                     "model": saved["selected"], "trainedThrough": d.date.max().date().isoformat(), "experimental": True})
    result = {"generatedAt": utcnow(), "modelVersion": report["modelVersion"], "status": "experimental", "dataHash": data_hash,
              "asOf": as_of.date().isoformat(), "target": TARGET, "predictions": rows, "limitations": report["limitations"]}
    atomic_json(root / "risk-predictions.json", result)
    ledger = root / "forward" / report["modelVersion"] / f"{as_of.date().isoformat()}.json"
    if not ledger.exists():  # write-once
        atomic_json(ledger, {"recordedAt": utcnow(), "asOf": as_of.date().isoformat(), "dataHash": data_hash,
                             "predictions": [{k: r[k] for k in ("symbol", "probabilityHighVolatility", "riskTier")} for r in rows]})
    return result


def score_forward(data_dir):
    root = Path(data_dir)
    report = json.loads((root / "reports" / "risk-latest.json").read_text(encoding="utf-8"))
    frames, meta, _, _ = load_candles(root)
    d = risk_frame(risk_panel(frames, meta)).set_index(["date", "symbol"])
    rows = []
    files = sorted((root / "forward" / report["modelVersion"]).glob("*.json"))
    for file in files:
        entry = json.loads(file.read_text(encoding="utf-8"))
        for p in entry["predictions"]:
            key = (pd.Timestamp(entry["asOf"]), p["symbol"])
            if key in d.index:
                rows.append({"date": key[0], "y": int(d.loc[key, "y"]), "p": p["probabilityHighVolatility"]})
    summary = {"generatedAt": utcnow(), "modelVersion": report["modelVersion"], "status": "experimental", "recordedDays": len(files)}
    if rows:
        frame = pd.DataFrame(rows)
        summary.update({"scored": True, "maturedSessions": int(frame.date.nunique()), **classification(frame.y, frame.p), "auc": auc(frame.y, frame.p)})
    else:
        summary["scored"] = False
    atomic_json(root / "reports" / "risk-forward.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["train", "infer", "score-forward"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    try:
        result = {"train": train, "infer": infer, "score-forward": score_forward}[args.command](args.data_dir)
        print(json.dumps({"status": result["status"], "modelVersion": result["modelVersion"]}, indent=2))
    except Exception as error:
        atomic_json(Path(args.data_dir) / "reports" / "risk-last-error.json", {"generatedAt": utcnow(), "status": "failed", "error": str(error)})
        raise


if __name__ == "__main__":
    main()
