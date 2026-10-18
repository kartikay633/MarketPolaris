"""Volatility-regime risk research engine (pulse-risk-v4).

Run: python -m ml.risk {train,infer,score-forward} --data-dir data/pulse

Question: after a completed NSE session, will a stock's realised volatility over
the next 20 sessions (daily close-to-close returns t+1..t+20) exceed its own
normal level, defined as the median 20-session volatility over the trailing 252
sessions (known at t)? Protocol, fixed in code before results are inspected and
matching pulse-rank-v2:

* v2 (2026-10-18) keeps the v1 target, split, candidates and calibration and changes
  only the inputs: range-based (Parkinson, Garman-Klass) and multi-horizon realised
  volatility, each relative to the stock's normal level; the same window one and two
  years earlier (results-season cycle); volatility persistence statistics; calendar
  position; and India VIX (implied market volatility). The feature set was chosen on
  development walk-forward folds only.
* v3 (2026-10-18) adds the results calendar from NSE board-meeting intimations
  (ml.disclosure_features): sessions to the next results meeting, counted only
  once NSE had disseminated the intimation by 18:00 IST, sessions since the last
  one, and whether results are due or expected within the horizon.
* v4 (2026-10-18) adds stock implied volatility from NSE F&O bhavcopies
  (ml.option_features, method atm-iv-v1): 20-session ATM implied volatility versus
  the stock's normal level and its own trailing median, implied minus realised
  volatility, and an availability flag (non-F&O stocks are imputed). Chosen on
  development folds with a gate fixed in advance (see ml/RESULTS.md).

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

from ml.disclosure_features import RESULTS_FEATURES, results_calendar
from ml.option_features import CORE as IV_FEATURES, add_option_features
from ml.pulse import atomic_json, load_candles, utcnow
from ml.rank import (CALENDAR, CORPORATE_EVENTS, REFIT_EVERY, SEED,
                     accuracy_ci, build_panel, classification, logit, calibrate, reliability, selective,
                     split_dates)

VERSION = "pulse-risk-v4"
HORIZON = 20
NORMAL_WINDOW = 252
ELEVATED, CALM = .65, .35
VIX = "INDIA_VIX"
RANGE = ["pk20", "pk5", "gk20", "rv5", "rv66", "abs1", "gap20"]
VOL_FEATURES = (RANGE + [f"lr_{k}" for k in RANGE]
                + ["season1", "season2", "season1_jump", "base_rate_252", "normal_vs_long", "vol_of_vol", "vol_trend",
                   "volume_shock", "ret_dd_60", "doy_sin", "doy_cos", "month", "vix_level", "vix_vs_normal", "vix_chg5",
                   "lr_vol20", "lr_vol60"])
FEATURES = ([f"x_{k}" for k in VOL_FEATURES]
            + ["raw_vol_20", "raw_vol_60", "raw_idio_vol_60", "raw_beta_120", "cs_log_turnover_20", "cs_amihud_20",
               "mkt_vol_20", "mkt_trend_200", "dispersion_20"]
            + [f"n_{k}" for k in RESULTS_FEATURES] + ["n_results_soon_x_season"] + IV_FEATURES)
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
    "v2 was developed after the v1 holdout had been reported, and the finalist was scored once on that same period, so its holdout figures are optimistic; only the v2 forward ledger is untouched.",
    "Results dates come from NSE board-meeting intimations, usable only after NSE disseminated them; meetings announced at short notice or rescheduled are captured as filed, and a failed daily collection leaves upcoming meetings unknown.",
    "v3 and v4 were developed after earlier holdouts had been reported and were scored on that same period; only each version's forward ledger is untouched.",
    "Implied volatility exists only for F&O stocks (71-91% of rows a year); a missing bhavcopy is carried forward at most 3 sessions, then imputed.",
]


def experiment_identity(data_hash):
    here = Path(__file__)
    source = (here.read_bytes() + here.with_name("rank.py").read_bytes() + here.with_name("pulse.py").read_bytes()
              + here.with_name("disclosure_features.py").read_bytes() + here.with_name("option_features.py").read_bytes())
    protocol = {"seed": SEED, "horizon": HORIZON, "features": FEATURES, "candidates": CANDIDATES,
                "events": CORPORATE_EVENTS, "refit": REFIT_EVERY, "tiers": [ELEVATED, CALM], "version": VERSION}
    return hashlib.sha256(json.dumps({"data": data_hash, "source": hashlib.sha256(source).hexdigest(),
                                      "protocol": protocol}, sort_keys=True).encode()).hexdigest()


def risk_panel(frames, meta, data_root=None):
    """ml.rank panel plus the volatility label and its causal reference level.

    data_root holds news-history/board-meetings and fo-history; without it the
    results-calendar and implied-volatility inputs are missing and imputed."""
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
    add_volatility_features(long, frames, stocks, cal, vol20, normal, pick)
    calendar = (results_calendar(data_root, cal, stocks) if data_root else
                {k: pd.DataFrame(np.nan, index=cal, columns=stocks) for k in RESULTS_FEATURES})
    for k, v in calendar.items():
        long[f"n_{k}"] = pick(v)
    long["n_results_soon_x_season"] = long.n_results_in_20 * long.x_season1
    add_option_features(long, data_root, cal, stocks, pick)
    return long


def add_volatility_features(long, frames, stocks, cal, vol20, normal, pick):
    """v2 inputs; every value uses bars at or before the signal date."""
    W = {f: pd.DataFrame({s: frames[s][f].reindex(cal) for s in stocks}) for f in ["open", "high", "low", "close", "volume"]}
    O, H, L, C, V = (W[f] for f in ["open", "high", "low", "close", "volume"])
    r = C.pct_change(fill_method=None)
    roll = lambda x, n: x.rolling(n, min_periods=max(2, int(n * .9)))
    hl, co = np.log(H / L) ** 2, np.log(C / O) ** 2
    f = {"pk20": np.sqrt(roll(hl / (4 * np.log(2)), 20).mean()), "pk5": np.sqrt(roll(hl / (4 * np.log(2)), 5).mean()),
         "gk20": np.sqrt(roll((.5 * hl - (2 * np.log(2) - 1) * co).clip(lower=0), 20).mean()),
         "rv5": roll(r, 5).std(), "rv66": roll(r, 66).std(), "abs1": r.abs(),
         "gap20": np.sqrt(roll(np.log(O / C.shift(1)) ** 2, 20).mean())}
    for k in RANGE:
        f[f"lr_{k}"] = np.log(f[k] / normal)
    # The same 20-session window one and two years earlier captures each stock's results-season cycle.
    f["season1"] = np.log(vol20.shift(NORMAL_WINDOW - 20) / normal.shift(NORMAL_WINDOW))
    f["season2"] = np.log(vol20.shift(2 * NORMAL_WINDOW - 20) / normal.shift(2 * NORMAL_WINDOW))
    f["season1_jump"] = np.log(vol20.shift(NORMAL_WINDOW - 20) / vol20.shift(NORMAL_WINDOW))
    f["base_rate_252"] = (vol20 > normal).astype(float).where(normal.notna()).rolling(252, min_periods=200).mean()
    f["normal_vs_long"] = np.log(normal / vol20.rolling(756, min_periods=500).median())
    f["vol_of_vol"] = roll(np.log(vol20), 60).std()
    f["vol_trend"] = np.log(vol20 / vol20.shift(5))
    f["volume_shock"] = np.log(roll(V, 5).mean() / roll(V, 252).median())
    f["ret_dd_60"] = C / roll(C, 60).max() - 1
    for k, v in f.items():
        long[f"x_{k}"] = pick(v.replace([np.inf, -np.inf], np.nan))
    market = {"doy_sin": np.sin(2 * np.pi * cal.dayofyear / 365.25), "doy_cos": np.cos(2 * np.pi * cal.dayofyear / 365.25),
              "month": cal.month.astype(float)}
    market = {k: pd.Series(np.asarray(v, dtype=float), index=cal) for k, v in market.items()}
    vix = frames[VIX].close.reindex(cal) if VIX in frames else pd.Series(np.nan, index=cal)
    market["vix_level"] = np.log(vix)
    market["vix_vs_normal"] = np.log(vix / vix.rolling(252, min_periods=200).median())
    market["vix_chg5"] = np.log(vix / vix.shift(5))
    for k, v in market.items():
        long[f"x_{k}"] = v.replace([np.inf, -np.inf], np.nan).reindex(long.date).to_numpy()
    long["x_lr_vol20"] = np.log(long.vol_vs_normal)
    long["x_lr_vol60"] = np.log(long.vol60_vs_normal)


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
    d = risk_frame(risk_panel(frames, meta, root))
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
    long = risk_panel(frames, meta, root)
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
    d = risk_frame(risk_panel(frames, meta, root)).set_index(["date", "symbol"])
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
