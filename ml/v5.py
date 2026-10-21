"""Polaris AI v5 (shadow): search on development folds, then production models (ml/V5_PROTOCOL.md).

Run: python -m ml.v5 cache                    development rows only (holdout removed), every column
     python -m ml.v5 diagnose                 where the wide risk model loses accuracy (development folds)
     python -m ml.v5 search risk|rank NAME... score named variants on the folds; appended to the trial ledger
     python -m ml.v5 final                    once: chosen variants on the holdout (a second look)

Selection uses the cached development rows only, so no experiment can touch a holdout row. Scores are
computed on tradable rows: the top 90% of each date by 20-session traded value, matching the shadow
account's ₹10 crore rule today (672 of 747 stocks on 21 October 2026).
"""
from __future__ import annotations

import argparse
import gc
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import ml.rank as rank
import ml.risk as risk
import ml.wide as wide
from ml.pulse import atomic_json, utcnow

ROOT = wide.ROOT
CACHE = ROOT / "cache"
LEDGER = ROOT / "reports" / "v5-search.jsonl"
TRADABLE_SHARE = .9
SEED = rank.SEED
log = wide.log

RISK_BASE = risk.FEATURES
RANK_BASE = rank.FEATURES
# Round 2: inputs already in the panel that v4 does not use (past and same-date values only).
RISK_PLUS = RISK_BASE + wide.EXTRA_RISK + [
    "raw_ret_5", "raw_ret_20", "raw_ret_60", "raw_dist_high_252", "raw_dist_low_252", "raw_max_ret_20", "raw_range_20",
    "raw_overnight_1", "raw_downside_vol_60", "raw_log_turnover_20", "raw_amihud_20", "cs_vol_20", "cs_vol_60", "cs_range_20",
    "breadth_50", "mkt_ret_5", "mkt_ret_20", "o_iv", "o_iv_term", "o_iv_chg5", "o_iv_rv_ratio"]
RANK_PLUS = RANK_BASE + wide.EXTRA_RANK + ["raw_vol_20", "raw_beta_120", "raw_log_turnover_20", "raw_dist_high_252", "raw_mom_12_1"]


# ------------------------------------------------------------------ data

def tradable(d):
    """Top 90% of each date by 20-session traded value (same-date information only)."""
    return d.raw_log_turnover_20.groupby(d.date).rank(pct=True) > 1 - TRADABLE_SHARE


def compact(d):
    for c in ("symbol", "sector"):
        if c in d:
            d[c] = d[c].astype("category")
    return d


def cache():
    CACHE.mkdir(parents=True, exist_ok=True)
    frames, meta, data_hash, events, cleaning = wide.load()
    for kind in ("risk", "rank"):
        d = wide.risk_data(frames, meta, full=True) if kind == "risk" else wide.rank_data(frames, meta, full=True)
        d["tradable"] = tradable(d)
        dev, _, starts = wide.split(d)
        dev = compact(dev.copy())
        del d
        gc.collect()
        dev.to_pickle(CACHE / f"v5-{kind}-dev.pkl")
        atomic_json(CACHE / f"v5-{kind}-dev.json", {"generatedAt": utcnow(), "dataHash": data_hash, "cleaning": cleaning,
                                                    "rows": int(len(dev)), "tradableRows": int(dev.tradable.sum()), "columns": list(dev.columns),
                                                    "start": dev.date.min().date().isoformat(), "end": dev.date.max().date().isoformat(),
                                                    "foldStarts": [pd.Timestamp(s).date().isoformat() for s in starts]})
        log(f"cached {kind}: {len(dev):,} development rows, {int(dev.tradable.sum()):,} tradable, {dev.shape[1]} columns")
        del dev
        gc.collect()


def load_dev(kind):
    d = pd.read_pickle(CACHE / f"v5-{kind}-dev.pkl")
    info = json.loads((CACHE / f"v5-{kind}-dev.json").read_text(encoding="utf-8"))
    return d, [pd.Timestamp(s) for s in info["foldStarts"]], info


def folds(d, starts):
    for start, end in zip(starts[:-1], starts[1:]):
        yield start, np.flatnonzero((d.labelEnd < start).to_numpy()), np.flatnonzero(((d.date >= start) & (d.labelEnd < end)).to_numpy())


# ------------------------------------------------------------------ targets and models

_TARGETS = {}


def target(d, name):
    """Computed once over the whole frame: every date is wholly in or out of a training set."""
    key = (id(d), name)
    if key not in _TARGETS:
        _TARGETS[key] = _target(d, name)
    return _TARGETS[key]


def _target(d, name):
    if name == "y":
        return d.y.to_numpy()
    if name == "logratio":            # continuous version of the risk label
        return np.log(d.future_vol / d.normal_vol).to_numpy()
    if name == "y_peer":
        return d.y_peer.to_numpy()
    if name == "rank":                # cross-sectional rank of the 20-session excess return, -0.5..0.5
        return (d.excess.groupby(d.date).rank(pct=True) - .5).to_numpy()
    if name == "rank_sector":         # rank of the return against the stock's own sector median
        sector_ex = d.fwd - d.groupby(["date", "sector"], observed=True).fwd.transform("median")
        return (sector_ex.groupby(d.date).rank(pct=True) - .5).to_numpy()
    if name == "rank_riskadj":        # rank of excess return per unit of the stock's recent volatility
        ra = d.excess / d.raw_vol_60.where(d.raw_vol_60 > 0)
        return (ra.groupby(d.date).rank(pct=True) - .5).to_numpy()
    raise ValueError(name)


CLASSIFICATION = {"y", "y_peer"}


def make_model(spec, classify):
    kind, params = spec["model"], dict(spec.get("params", {}))
    if kind == "logit":
        return make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True), StandardScaler(),
                             LogisticRegression(C=params.get("C", .05), max_iter=1000) if classify else Ridge(alpha=params.get("alpha", 100.)))
    if kind == "hgb":
        base = dict(max_iter=300, learning_rate=.05, max_leaf_nodes=31, min_samples_leaf=500, l2_regularization=1., max_features=.5,
                    early_stopping=False, random_state=SEED)
        base.update(params)
        return HistGradientBoostingClassifier(**base) if classify else HistGradientBoostingRegressor(**base)
    if kind in ("xgb", "xgbrank"):
        import xgboost as xgb
        base = dict(n_estimators=600, learning_rate=.03, max_depth=6, min_child_weight=200, subsample=.8, colsample_bytree=.5,
                    reg_lambda=5., tree_method="hist", n_jobs=16, random_state=SEED, verbosity=0)
        base.update(params)
        if kind == "xgbrank":
            return xgb.XGBRanker(objective=params.get("objective", "rank:pairwise"), **{k: v for k, v in base.items() if k != "objective"})
        return xgb.XGBClassifier(**base) if classify else xgb.XGBRegressor(**base)
    if kind == "cat":
        from catboost import CatBoostClassifier, CatBoostRegressor
        base = dict(iterations=800, learning_rate=.05, depth=6, l2_leaf_reg=5., thread_count=16, random_seed=SEED, verbose=False)
        base.update(params)
        return CatBoostClassifier(**base) if classify else CatBoostRegressor(**base)
    raise ValueError(kind)


def output(model, X, classify):
    return model.predict_proba(X)[:, 1] if classify and hasattr(model, "predict_proba") else model.predict(X)


def training_rows(d, idx, spec, start):
    """Optional training universe, window and recency weights; all use dates before the fold start."""
    rows = idx
    if spec.get("train") == "tradable":
        rows = rows[d.tradable.to_numpy()[rows]]
    dates = d.date.to_numpy()[rows]
    weight = None
    if spec.get("window") or spec.get("halflife"):
        cal = np.sort(d.date.unique())
        age = np.searchsorted(cal, np.datetime64(start)) - np.searchsorted(cal, dates)
        if spec.get("window"):
            keep = age <= spec["window"]
            rows, age = rows[keep], age[keep]
        if spec.get("halflife"):
            weight = .5 ** (age / spec["halflife"])
    return rows, weight


def fit_one(d, rows, weight, spec):
    tname = spec["target"]
    classify = tname in CLASSIFICATION
    y = target(d, tname)[rows]
    ok = np.isfinite(y)
    rows, y = rows[ok], y[ok]
    weight = weight[ok] if weight is not None else None
    X = d[spec["features"]].iloc[rows]
    model = make_model(spec, classify)
    if spec["model"] == "xgbrank":
        # XGBoost's ranker needs rows grouped by query (date) and an integer relevance label.
        order = np.argsort(d.date.to_numpy()[rows], kind="stable")
        rows, y, X = rows[order], y[order], X.iloc[order]
        grade = np.clip(((y + .5) * 5).astype(int), 0, 4)
        model.fit(X, grade, qid=pd.factorize(d.date.to_numpy()[rows])[0])
    elif spec["model"] == "logit":
        model.fit(X, y, **({"logisticregression__sample_weight" if classify else "ridge__sample_weight": weight} if weight is not None else {}))
    else:
        model.fit(X, y, **({"sample_weight": weight} if weight is not None else {}))
    return model, classify


def inputs(spec):
    return list(dict.fromkeys(spec["features"] if "features" in spec and spec["model"] != "blend" else [c for p in spec["parts"] for c in inputs(p)]))


def fit_spec(d, train_idx, spec, start):
    """A fitted variant that can be saved: one model, or a blend of standardised component scores.
    Each model keeps the mean and spread of its scores on (a sample of) its training rows."""
    if spec["model"] == "blend":
        return {"blend": [fit_spec(d, train_idx, part, start) for part in spec["parts"]]}
    rows, weight = training_rows(d, train_idx, spec, start)
    model, classify = fit_one(d, rows, weight, spec)
    sample = rows if len(rows) <= 200_000 else np.random.default_rng(SEED).choice(rows, 200_000, replace=False)
    fitted = {"model": model, "classify": classify, "features": spec["features"]}
    p = predict_frame(fitted, d[spec["features"]].iloc[sample])
    fitted["mu"], fitted["sd"] = float(np.nanmean(p)), float(np.nanstd(p)) or 1.
    return fitted


def predict_frame(fitted, X):
    if "blend" in fitted:
        return np.mean([(predict_frame(p, X) - p["mu"]) / p["sd"] for p in fitted["blend"]], axis=0)
    return output(fitted["model"], X[fitted["features"]], fitted["classify"])


def fit_predict(d, train_idx, valid_idx, spec, start):
    fitted = fit_spec(d, train_idx, spec, start)
    return fitted, predict_frame(fitted, d[inputs(spec)].iloc[valid_idx])


# ------------------------------------------------------------------ scoring

def score(kind, d, idx, p):
    va = d[["date", "symbol", "tradable"] + (["y"] if kind == "risk" else ["fwd", "excess", "bench_20"])].iloc[idx]
    t = va.tradable.to_numpy()
    if kind == "risk":
        return {"auc": float(roc_auc_score(va.y.to_numpy()[t], p[t])), "aucAll": float(roc_auc_score(va.y, p)), "rows": int(t.sum())}
    sub = va.loc[t]
    ic = rank.daily_ic(sub, p[t])
    port = rank.portfolio(sub, p[t], 20)
    return {"ic": float(ic.mean()), "icHit": float((ic > 0).mean()), "excess": float(port["annualExcessVsUniverse"]), "rows": int(t.sum())}


def run(kind, name, spec, d, starts):
    t0 = time.time()
    out, oof = [], []
    for start, tr, va in folds(d, starts):
        _, p = fit_predict(d, tr, va, spec, start)
        s = score(kind, d, va, p)
        s["validationStart"] = pd.Timestamp(start).date().isoformat()
        out.append(s)
        oof.append(pd.Series(p, index=d.index[va]))
        gc.collect()
    key = "auc" if kind == "risk" else "ic"
    result = {"at": utcnow(), "kind": kind, "name": name, "spec": describe(spec), "folds": out,
              "mean": float(np.mean([f[key] for f in out])), "minutes": round((time.time() - t0) / 60, 1)}
    if kind == "rank":
        result["meanExcess"] = float(np.mean([f["excess"] for f in out]))
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(result) + "\n")
    extra = f"  excess {result['meanExcess']:+.3f}" if kind == "rank" else ""
    log(f"{kind} {name:<28} mean {key} {result['mean']:.4f}  folds {' '.join(f'{f[key]:.3f}' for f in out)}{extra}  ({result['minutes']} min)")
    return result, pd.concat(oof)


def describe(spec):
    s = {k: v for k, v in spec.items() if k not in ("features", "parts")}
    if "features" in spec:
        s["inputs"] = len(spec["features"])
    if "parts" in spec:
        s["parts"] = [describe(p) for p in spec["parts"]]
    return s


# ------------------------------------------------------------------ variants

def risk_variants():
    base = dict(features=RISK_BASE, target="y")
    wide_inputs = RISK_BASE + wide.EXTRA_RISK
    hgb = dict(model="hgb", params=wide.V4_RISK_GBM)
    v = {
        "r-logit": {**base, "model": "logit"},
        "r-hgb": {**base, **hgb},
        "r-ensemble": {**base, "model": "blend", "parts": [{**base, "model": "logit"}, {**base, **hgb}]},
        "r-hgb-tradable": {**base, **hgb, "train": "tradable"},
        "r-hgb-10y": {**base, **hgb, "window": 2520},
        "r-hgb-6y": {**base, **hgb, "window": 1512},
        "r-hgb-hl3y": {**base, **hgb, "halflife": 756},
        "r-hgb-reg": {**base, **hgb, "target": "logratio"},
        "r-hgb-wide": {**base, **hgb, "features": wide_inputs},
        "r-xgb": {**base, "model": "xgb"},
        "r-xgb-reg": {**base, "model": "xgb", "target": "logratio"},
        "r-cat": {**base, "model": "cat"},
        "r-cat-reg": {**base, "model": "cat", "target": "logratio"},
    }
    # Round 2: steadier boosting (slower learning, bigger leaves) and the extra inputs.
    calm = dict(max_iter=600, learning_rate=.03, max_leaf_nodes=15, min_samples_leaf=3000, l2_regularization=5., max_features=.5)
    v.update({
        "r-hgb-calm": {**base, "model": "hgb", "params": calm},
        "r-hgb-calm-reg": {**base, "model": "hgb", "params": calm, "target": "logratio"},
        "r-hgb-plus": {**base, "model": "hgb", "params": calm, "features": RISK_PLUS},
        "r-hgb-plus-reg": {**base, "model": "hgb", "params": calm, "features": RISK_PLUS, "target": "logratio"},
        "r-logit-plus": {**base, "model": "logit", "features": RISK_PLUS},
        "r-xgb-plus-reg": {**base, "model": "xgb", "features": RISK_PLUS, "target": "logratio", "params": dict(max_depth=5, min_child_weight=1000)},
        "r-cat-plus-reg": {**base, "model": "cat", "features": RISK_PLUS, "target": "logratio"},
    })
    # Round 3: blends of a linear and tree models (the round-1 blend beat every single model).
    v.update({
        "r-blend-plus": {**base, "model": "blend", "parts": [v["r-logit-plus"], v["r-hgb-plus"]]},
        "r-blend-plus-reg": {**base, "model": "blend", "parts": [v["r-logit-plus"], v["r-hgb-plus-reg"]]},
        "r-blend3-plus": {**base, "model": "blend", "parts": [v["r-logit-plus"], v["r-hgb-plus"], v["r-xgb-plus-reg"]]},
        "r-blend3": {**base, "model": "blend", "parts": [v["r-logit"], v["r-hgb-calm"], v["r-xgb-reg"]]},
    })
    return v


def rank_variants():
    base = dict(features=RANK_BASE, target="y_peer")
    hgb = dict(model="hgb", params=wide.V2_RANK_GBM)
    v = {
        "k-hgb": {**base, **hgb},
        "k-hgb-tradable": {**base, **hgb, "train": "tradable"},
        "k-hgb-reg": {**base, **hgb, "target": "rank"},
        "k-hgb-reg-sector": {**base, **hgb, "target": "rank_sector"},
        "k-hgb-reg-riskadj": {**base, **hgb, "target": "rank_riskadj"},
        "k-hgb-10y": {**base, **hgb, "window": 2520},
        "k-hgb-hl3y": {**base, **hgb, "halflife": 756},
        "k-xgb": {**base, "model": "xgb", "params": dict(max_depth=4, min_child_weight=2000)},
        "k-xgb-reg": {**base, "model": "xgb", "target": "rank", "params": dict(max_depth=4, min_child_weight=2000)},
        "k-xgbrank": {**base, "model": "xgbrank", "target": "rank", "params": dict(max_depth=4, min_child_weight=2000)},
        "k-cat-reg": {**base, "model": "cat", "target": "rank", "params": dict(depth=4)},
        "k-logit-reg": {**base, "model": "logit", "target": "rank"},
    }
    calm = dict(max_iter=500, learning_rate=.02, max_leaf_nodes=15, min_samples_leaf=5000, l2_regularization=5., max_features=.5)
    v.update({
        "k-hgb-calm-reg": {**base, "model": "hgb", "params": calm, "target": "rank"},
        "k-hgb-plus-reg": {**base, "model": "hgb", "params": calm, "target": "rank", "features": RANK_PLUS},
        "k-logit-plus-reg": {**base, "model": "logit", "target": "rank", "features": RANK_PLUS},
        "k-hgb-calm-riskadj": {**base, "model": "hgb", "params": calm, "target": "rank_riskadj"},
    })
    v.update({
        "k-blend-trees": {**base, "model": "blend", "parts": [v["k-xgb-reg"], v["k-hgb-plus-reg"], v["k-cat-reg"]]},
        "k-blend-two": {**base, "model": "blend", "parts": [v["k-xgb-reg"], v["k-hgb-plus-reg"]]},
        "k-blend-linear": {**base, "model": "blend", "parts": [v["k-xgb-reg"], v["k-logit-plus-reg"]]},
    })
    return v


VARIANTS = {"risk": risk_variants, "rank": rank_variants}


def capacity(spec):
    """Rough model size, the last tie-breaker: trees times leaves; a linear model counts as one."""
    p = spec.get("params", {})
    if spec["model"] == "blend":
        return sum(capacity(part) for part in spec["parts"])
    if spec["model"] == "logit":
        return 1
    if spec["model"] == "hgb":
        return p.get("max_iter", 300) * p.get("max_leaf_nodes", 31)
    if spec["model"] in ("xgb", "xgbrank"):
        return p.get("n_estimators", 600) * 2 ** p.get("max_depth", 6)
    return p.get("iterations", 800) * 2 ** p.get("depth", 6)


def choose(kind):
    """The protocol's rule over every variant in the trial ledger: best mean development score; within
    0.002 of it counts as tied, and the simplest tied variant wins (fewer inputs, single model, size)."""
    registry = VARIANTS[kind]()
    latest = {}
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        if r["kind"] == kind and r["name"] in registry:
            latest[r["name"]] = r
    best = max(r["mean"] for r in latest.values())
    tied = [n for n, r in latest.items() if r["mean"] >= best - wide.TIE]
    key = lambda n: (len(inputs(registry[n])), registry[n]["model"] == "blend", capacity(registry[n]))
    pick = min(tied, key=key)
    return {"kind": kind, "trials": len(latest), "best": max(latest, key=lambda n: latest[n]["mean"]), "bestMean": best,
            "tied": sorted(tied, key=key), "chosen": pick, "chosenMean": latest[pick]["mean"], "folds": latest[pick]["folds"]}


def search(kind, names):
    d, starts, info = load_dev(kind)
    log(f"{kind}: {len(d):,} development rows ({info['start']} to {info['end']}), folds from {info['foldStarts'][0]}")
    registry = VARIANTS[kind]()
    for name in names:
        run(kind, name, registry[name], d, starts)


# ------------------------------------------------------------------ diagnosis

def diagnose():
    d, starts, _ = load_dev("risk")
    core = {p.stem for p in (wide.CORE / "candles").glob("*.json")}
    base = dict(features=RISK_BASE, target="y")
    spec = {**base, "model": "blend", "parts": [{**base, "model": "logit"}, {**base, "model": "hgb", "params": wide.V4_RISK_GBM}]}
    _, oof = run("risk", "diagnose: r-ensemble", spec, d, starts)
    v = d.loc[oof.index, ["date", "symbol", "y", "tradable", "raw_log_turnover_20", "o_has_iv", "future_vs_normal"]].copy()
    v["p"] = oof.to_numpy()
    v["core"] = v.symbol.astype(str).isin(core)
    v["liquidity"] = v.groupby("date").raw_log_turnover_20.rank(pct=True).fillna(.5).mul(5).clip(upper=4.999).astype(int) + 1
    v["year"] = v.date.dt.year
    auc = lambda g: float(roc_auc_score(g.y, g.p)) if g.y.nunique() == 2 else None
    report = {"generatedAt": utcnow(), "rows": int(len(v)), "overall": auc(v)}
    for col in ("core", "tradable", "o_has_iv", "liquidity", "year"):
        report[col] = {str(k): {"auc": auc(g), "rows": int(len(g)), "positiveRate": float(g.y.mean()),
                                "labelNoise": float((g.future_vs_normal.sub(1).abs() < .1).mean())} for k, g in v.groupby(col)}
    # Does the core lose from training on twenty years and 700 stocks? Same core validation rows, other training sets.
    core_rows = d.symbol.astype(str).isin(core).to_numpy()
    hgb = {**base, "model": "hgb", "params": wide.V4_RISK_GBM}
    for label, extra in (("all stocks, all years", {}), ("all stocks, last 10 years", {"window": 2520})):
        scores = []
        for start, tr, va in folds(d, starts):
            va = va[core_rows[va]]
            _, p = fit_predict(d, tr, va, {**hgb, **extra}, start)
            scores.append(float(roc_auc_score(d.y.to_numpy()[va], p)))
        report.setdefault("coreTraining", {})[label] = {"folds": scores, "mean": float(np.mean(scores))}
    for label, extra in (("core stocks only, all years", {}), ("core stocks only, last 10 years", {"window": 2520})):
        scores = []
        for start, tr, va in folds(d, starts):
            tr, va = tr[core_rows[tr]], va[core_rows[va]]
            _, p = fit_predict(d, tr, va, {**hgb, **extra}, start)
            scores.append(float(roc_auc_score(d.y.to_numpy()[va], p)))
        report["coreTraining"][label] = {"folds": scores, "mean": float(np.mean(scores))}
    atomic_json(ROOT / "reports" / "v5-diagnosis.json", report)
    log(json.dumps({k: report[k] for k in ("overall", "core", "tradable", "o_has_iv", "liquidity", "coreTraining")}, indent=1))


# ------------------------------------------------------------------ final check (once) and production

CHOSEN = {"risk": "r-blend-plus", "rank": "k-hgb-calm-reg"}  # choose() on 43 development trials, 22 Oct 2026, before `final`
BASELINE = {"risk": "r-ensemble", "rank": "k-hgb"}  # the wide R-v4 ensemble and K-v2 gbm already scored on the holdout
BASELINE_FILES = {"risk": "wide-holdout-risk.csv", "rank": "wide-holdout-rank.csv"}
TOLERANCE = .005
LIQUID = 1e8          # ₹10 crore a day: the shadow account buys nothing below it
REFIT_SESSIONS = 21   # production models are refitted monthly on all labelled rows
HISTORY = 1500        # sessions kept for nightly forecasts; every input looks back at most ~800
MODELS = ROOT / "models" / "v5"


def labelled(kind, frames, meta):
    long = wide.risk_long(frames, meta) if kind == "risk" else wide.rank_long(frames, meta)
    d = risk.risk_frame(long) if kind == "risk" else rank.horizon_frame(long, 20)
    del long
    gc.collect()
    d["tradable"] = tradable(d)
    return compact(d)


def label_of(kind):
    return "y" if kind == "risk" else "y_peer"


def calibrator_for(spec, scores, y):
    """Scores to probabilities: logistic on the log-odds of a classifier, on the raw score otherwise."""
    odds = spec["model"] != "blend" and spec["target"] in CLASSIFICATION
    x = rank.logit(scores) if odds else np.asarray(scores).reshape(-1, 1)
    return {"model": LogisticRegression(C=1.).fit(x, y), "odds": odds}


def calibrated(cal, scores):
    x = rank.logit(scores) if cal["odds"] else np.asarray(scores).reshape(-1, 1)
    return cal["model"].predict_proba(x)[:, 1]


def out_of_sample(kind, d, spec):
    """Development out-of-fold scores (the four purged folds) and holdout scores refitted every 63 sessions."""
    H = wide.HOLDOUT_START
    dev_mask = ((d.date < H) & (d.labelEnd < H)).to_numpy()
    dates = np.sort(d.date[dev_mask].unique())
    starts = [pd.Timestamp(dates[int(len(dates) * q)]) for q in wide.FOLD_POINTS] + [H]
    dev_idx, dev_p = [], []
    for start, end in zip(starts[:-1], starts[1:]):
        tr = np.flatnonzero((d.labelEnd < start).to_numpy() & dev_mask)
        va = np.flatnonzero(((d.date >= start) & (d.labelEnd < end)).to_numpy() & dev_mask)
        _, p = fit_predict(d, tr, va, spec, start)
        dev_idx.append(va), dev_p.append(p)
    hold = np.sort(d.date[d.date >= H].unique())
    hold_idx, hold_p = [], []
    for i in range(0, len(hold), rank.REFIT_EVERY):
        start = pd.Timestamp(hold[i])
        end = pd.Timestamp(hold[i + rank.REFIT_EVERY]) if i + rank.REFIT_EVERY < len(hold) else None
        tr = np.flatnonzero((d.labelEnd < start).to_numpy())
        va = np.flatnonzero(((d.date >= start) & ((d.date < end) if end is not None else True)).to_numpy())
        _, p = fit_predict(d, tr, va, spec, start)
        hold_idx.append(va), hold_p.append(p)
        log(f"  {kind} holdout block from {start.date()}: {len(va):,} rows")
    return np.concatenate(dev_idx), np.concatenate(dev_p), np.concatenate(hold_idx), np.concatenate(hold_p)


def holdout_scores(kind, frame, p):
    """Tradable holdout rows only, as the protocol counts them."""
    t = frame.tradable.to_numpy()
    sub, q = frame.loc[t], np.asarray(p)[t]
    if kind == "risk":
        out = rank.classification(sub.y, q)
        out["auc"] = float(roc_auc_score(sub.y, q))
        out["tiers"] = risk.tiers(sub.assign(future_vs_normal=sub.future_vol / sub.normal_vol), q)
        return out
    out = {"ranking": rank.ic_summary(rank.daily_ic(sub, q), 20), "portfolio": rank.portfolio(sub, q, 20), "quintiles": rank.quintiles(sub, q)}
    out["meanIC"] = out["ranking"]["meanIC"]
    return out


def final():
    if not all(CHOSEN.values()):
        raise SystemExit("Set CHOSEN from the development search before the holdout check")
    target_file = ROOT / "reports" / "v5-final.json"
    if target_file.exists():
        raise SystemExit("The v5 holdout check has already run; it is scored once")
    frames, meta, data_hash, events, cleaning = wide.load()
    if json.loads((CACHE / "v5-risk-dev.json").read_text(encoding="utf-8"))["dataHash"] != data_hash:
        raise SystemExit("The candles changed since the development search; the check needs the same data")
    result = {"generatedAt": utcnow(), "protocol": "ml/V5_PROTOCOL.md", "dataHash": data_hash, "secondLook": True, "chosen": dict(CHOSEN)}
    saved = {}
    for kind in ("risk", "rank"):
        d = labelled(kind, frames, meta)
        registry = VARIANTS[kind]()
        key = "auc" if kind == "risk" else "meanIC"
        cols = ["symbol", "date", "tradable", label_of(kind)] + (["future_vol", "normal_vol"] if kind == "risk" else ["fwd", "excess", "bench_20"])
        runs = {}
        for role, name in (("chosen", CHOSEN[kind]), ("baseline", BASELINE[kind])):
            if role == "baseline" and name == CHOSEN[kind]:
                runs["baseline"] = runs["chosen"]
                continue
            spec = registry[name]
            dev_idx, dev_p, hold_idx, hold_p = out_of_sample(kind, d, spec)
            cal = calibrator_for(spec, dev_p, d[label_of(kind)].to_numpy()[dev_idx])
            frame = d[cols].iloc[hold_idx].reset_index(drop=True)
            runs[role] = {"name": name, "calibrator": cal, "frame": frame, "p": calibrated(cal, hold_p),
                          "scores": holdout_scores(kind, frame, calibrated(cal, hold_p))}
            log(f"{kind} {role} {name}: holdout {key} {runs[role]['scores'][key]:.4f} (tradable rows, second look)")
        # The baseline as already scored in the wide study, on the same rows: a check that the rerun matches.
        saved_wide = pd.read_csv(ROOT / "reports" / BASELINE_FILES[kind], parse_dates=["date"])
        merged = runs["baseline"]["frame"].assign(symbol=lambda f: f.symbol.astype(str)).merge(
            saved_wide[["symbol", "date", "probability"]], on=["symbol", "date"], how="left")
        coverage = float(merged.probability.notna().mean())
        wide_scores = (holdout_scores(kind, merged, merged.probability.fillna(merged.probability.median()).to_numpy())
                       if coverage > .99 else {key: None})
        wide_scores["coverage"] = coverage
        use = "chosen" if runs["chosen"]["scores"][key] >= runs["baseline"]["scores"][key] - TOLERANCE else "baseline"
        result[kind] = {"chosen": {"name": runs["chosen"]["name"], "holdout": runs["chosen"]["scores"]},
                        "baseline": {"name": runs["baseline"]["name"], "holdout": runs["baseline"]["scores"]},
                        "wideStudyBaselineSameRows": {key: wide_scores[key], "coverage": wide_scores["coverage"]}, "used": runs[use]["name"],
                        "rule": f"chosen unless more than {TOLERANCE} below the baseline on {key}"}
        saved[kind] = {"name": runs[use]["name"], "calibrator": runs[use]["calibrator"]}
        if kind == "rank":
            ci = runs[use]["scores"]["ranking"]["meanICConfidenceInterval"]
            result["start"] = bool(ci and ci["lower"] > 0)
            result["startRule"] = "ranking IC lower 95% bound above zero on tradable holdout rows"
        del d, runs
        gc.collect()
    saved["start"] = result["start"]
    MODELS.mkdir(parents=True, exist_ok=True)
    import joblib
    joblib.dump(saved, MODELS / "final.joblib")
    atomic_json(target_file, result)
    log(f"v5 uses risk {saved['risk']['name']}, ranking {saved['rank']['name']}; shadow account {'starts' if result['start'] else 'does not start'}")


def version(names):
    """Stable across monthly refits, so the forward ledger stays one continuous record."""
    import hashlib
    return "pulse-v5-" + hashlib.sha256(json.dumps([names, "ml/V5_PROTOCOL.md"], sort_keys=True).encode()).hexdigest()[:16]


def train():
    """Refit the chosen variants on every labelled row (monthly); calibrators come from the holdout check."""
    import joblib
    fin = joblib.load(MODELS / "final.joblib")
    frames, meta, data_hash, events, cleaning = wide.load()
    info = {"trainedAt": utcnow(), "dataHash": data_hash, "names": {k: fin[k]["name"] for k in ("risk", "rank")}, "cleaning": cleaning}
    for kind in ("risk", "rank"):
        d = labelled(kind, frames, meta)
        spec = VARIANTS[kind]()[fin[kind]["name"]]
        fitted = fit_spec(d, np.arange(len(d)), spec, d.date.max() + pd.Timedelta(days=1))
        extra = {}
        if kind == "rank":  # plain-language reasons: a logistic model's contributions, as v4 shows them
            logistic = make_model({"model": "logit"}, True).fit(d[RANK_BASE], d.y_peer)
            extra["coefs"] = dict(zip(RANK_BASE, logistic[-1].coef_[0]))
        joblib.dump({"fitted": fitted, "trainedThrough": d.date.max().date().isoformat(), **extra}, MODELS / f"{kind}.joblib")
        info[f"{kind}TrainedThrough"] = d.date.max().date().isoformat()
        info[f"{kind}Rows"] = int(len(d))
        log(f"trained {kind} {fin[kind]['name']} on {len(d):,} rows through {info[f'{kind}TrainedThrough']}")
        del d
        gc.collect()
    info["calendarAsOf"] = frames[rank.CALENDAR].index.max().date().isoformat()
    info["modelVersion"] = version(info["names"])
    atomic_json(MODELS / "train.json", info)
    return info


def due():
    info_file = MODELS / "train.json"
    if not info_file.exists():
        return True
    info = json.loads(info_file.read_text(encoding="utf-8"))
    cal = json.loads((ROOT / "candles" / f"{rank.CALENDAR}.json").read_text(encoding="utf-8"))["candles"]
    return sum(c[0][:10] > info["calendarAsOf"] for c in cal) >= REFIT_SESSIONS


def infer():
    """Nightly: refit if a month has passed, then forecast the latest session for the shadow account."""
    import joblib
    fin = joblib.load(MODELS / "final.joblib")
    if not fin["start"]:
        raise SystemExit("v5 did not pass its holdout check; no shadow forecasts")
    if due():
        train()
    info = json.loads((MODELS / "train.json").read_text(encoding="utf-8"))
    frames, meta, data_hash, events, cleaning = wide.load()
    cal = frames[rank.CALENDAR].index
    first = cal[max(0, len(cal) - HISTORY)]
    frames = {s: f.loc[f.index >= first] for s, f in frames.items()}
    as_of = cal.max()
    rlong = wide.risk_long(frames, meta)
    rl = rlong.loc[rlong.date == as_of].reset_index(drop=True)
    del rlong
    klong = wide.rank_long(frames, meta)
    kl = klong.loc[klong.date == as_of].reset_index(drop=True)
    del klong
    gc.collect()
    rm, km = joblib.load(MODELS / "risk.joblib"), joblib.load(MODELS / "rank.joblib")
    pr = calibrated(fin["risk"]["calibrator"], predict_frame(rm["fitted"], rl))
    pk = calibrated(fin["rank"]["calibrator"], predict_frame(km["fitted"], kl))
    day, annual = as_of.date().isoformat(), np.sqrt(252)
    risk_rows = []
    for (_, row), prob in zip(rl.iterrows(), pr):
        risk_rows.append({"symbol": row.symbol, "sector": row.sector, "asOf": day, "horizon": 20, "probabilityHighVolatility": float(prob),
                          "riskTier": "elevated" if prob >= risk.ELEVATED else "calm" if prob <= risk.CALM else "normal",
                          "currentVolatilityAnnualised": float(row.raw_vol_20 * annual) if pd.notna(row.raw_vol_20) else None,
                          "normalVolatilityAnnualised": float(row.normal_vol * annual) if pd.notna(row.normal_vol) else None,
                          "currentVsNormal": float(row.vol_vs_normal) if pd.notna(row.vol_vs_normal) else None,
                          "model": fin["risk"]["name"], "trainedThrough": rm["trainedThrough"], "experimental": True})
    covered = {r["symbol"] for r in risk_rows if r["currentVolatilityAnnualised"] and r["normalVolatilityAnnualised"]}
    percentile = pd.Series(pk).rank(pct=True).to_numpy()
    rank_rows = []
    for i, row in kl.iterrows():
        if row.symbol not in covered:
            continue
        traded = float(np.exp(row.raw_log_turnover_20)) if pd.notna(row.raw_log_turnover_20) else 0.
        rank_rows.append({"symbol": row.symbol, "sector": row.sector, "asOf": day, "horizon": 20, "experimental": True,
                          "probabilityOutperformPeers": float(pk[i]), "peerRankPercentile": float(percentile[i]),
                          "tier": "top quintile" if percentile[i] > .8 else "bottom quintile" if percentile[i] <= .2 else "middle",
                          "tradable": traded >= LIQUID, "tradedValue20": traded, "model": fin["rank"]["name"],
                          "trainedThrough": km["trainedThrough"], "drivers": rank.drivers(row, km["coefs"])})
    version_id = info["modelVersion"]
    base = {"generatedAt": utcnow(), "modelVersion": version_id, "status": "shadow", "dataHash": data_hash, "asOf": day}
    atomic_json(ROOT / "risk-predictions-v5.json", {**base, "target": risk.TARGET, "predictions": [r for r in risk_rows if r["symbol"] in covered]})
    atomic_json(ROOT / "predictions-v5.json", {**base, "target": "Next-open to 20-session close return above the same-date median of the wide universe",
                                               "liquidityRule": "buys only stocks with 20-session average traded value of at least ₹10 crore",
                                               "predictions": rank_rows})
    ledger = ROOT / "forward" / version_id / f"{day}.json"
    if not ledger.exists():  # write-once
        atomic_json(ledger, {"recordedAt": utcnow(), "asOf": day, "dataHash": data_hash,
                             "rank": [{k: r[k] for k in ("symbol", "probabilityOutperformPeers", "peerRankPercentile", "tradable")} for r in rank_rows],
                             "risk": [{k: r[k] for k in ("symbol", "probabilityHighVolatility", "riskTier")} for r in risk_rows]})
    log(f"v5 forecasts for {day}: {len(rank_rows)} stocks, {sum(r['tradable'] for r in rank_rows)} tradable")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["cache", "diagnose", "search", "final", "train", "infer"])
    parser.add_argument("kind", nargs="?", choices=["risk", "rank"])
    parser.add_argument("names", nargs="*")
    args = parser.parse_args()
    if args.command == "cache":
        cache()
    elif args.command == "diagnose":
        diagnose()
    elif args.command == "search":
        search(args.kind, args.names or list(VARIANTS[args.kind]()))
    else:
        {"final": final, "train": train, "infer": infer}[args.command]()


if __name__ == "__main__":
    main()
