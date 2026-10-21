"""Wide-universe study (ml/WIDE_PROTOCOL.md with amendments 1 and 1b) on data/pulse-wide.

Run: python -m ml.wide dev risk     development folds only: every declared risk candidate
     python -m ml.wide dev rank     development folds only: every declared ranking candidate
     python -m ml.wide final        once: selected + unchanged-method candidates on the holdout, gates

Reuses v4's feature builders, metrics and protocol (ml.rank, ml.risk) unchanged. What differs is
fixed in the protocol: twenty years of history, the holdout fixed at 4 December 2024, demergers found
from NSE's corporate-actions record, a few declared extra inputs and boosting settings. `dev` removes
the holdout rows before any model is fitted, so they cannot influence the choice.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import ml.rank as rank
import ml.risk as risk
from ml.pulse import atomic_json, load_candles, utcnow

ROOT = Path(os.environ.get("PULSE_WIDE_DIR", "data/pulse-wide"))
CORE = Path("data/pulse")
HOLDOUT_START = pd.Timestamp("2024-12-04")
FOLD_POINTS = (.4, .55, .7, .85)
GAP, EVENT_DAYS = .25, 3
TIE = .002
SEED = rank.SEED

V4_RISK_GBM = dict(max_iter=300, learning_rate=.05, max_leaf_nodes=31, min_samples_leaf=500, l2_regularization=1., max_features=.5)
V2_RANK_GBM = dict(max_iter=300, learning_rate=.03, max_leaf_nodes=15, min_samples_leaf=1000, l2_regularization=1., max_features=.5)
EXTRA_RISK = ["w_sector_vol_rel", "w_cs_vol_rank", "w_stress_breadth"]  # traded-value rank is already v4's cs_log_turnover_20
EXTRA_RANK = ["cs_rel_sector_120"]                                       # likewise for ranking

RISK_FAMILIES = {
    "R-v4": {"features": risk.FEATURES, "models": ["persistence", "logistic", "gbm", "ensemble"], "gbm": V4_RISK_GBM},
    "R-wide": {"features": risk.FEATURES + EXTRA_RISK, "models": ["logistic", "gbm", "ensemble"], "gbm": V4_RISK_GBM},
    "R-gbm+": {"features": risk.FEATURES + EXTRA_RISK, "models": ["gbm", "ensemble"],
               "gbm": dict(max_iter=600, learning_rate=.03, max_leaf_nodes=63, min_samples_leaf=1000, l2_regularization=1., max_features=.5)},
}
RANK_FAMILIES = {
    "K-v2": {"features": rank.FEATURES, "models": list(rank.FACTORS) + ["logistic", "gbm", "ensemble"], "gbm": V2_RANK_GBM},
    "K-wide": {"features": rank.FEATURES + EXTRA_RANK, "models": ["logistic", "gbm", "ensemble"], "gbm": V2_RANK_GBM},
    "K-gbm+": {"features": rank.FEATURES + EXTRA_RANK, "models": ["gbm", "ensemble"],
               "gbm": dict(max_iter=500, learning_rate=.02, max_leaf_nodes=31, min_samples_leaf=2000, l2_regularization=1., max_features=.5)},
}
MODEL_ORDER = list(rank.FACTORS) + ["persistence", "logistic", "gbm", "ensemble"]  # simpler first, for ties


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ------------------------------------------------------------------ data

def corporate_events(frames, meta, root=ROOT):
    """Overnight gaps above 25% within three days of an NSE demerger/scheme/capital-reduction record."""
    records = json.loads((root / "corporate-actions.json").read_text(encoding="utf-8"))["events"]
    ex = {}
    for r in records:
        d = pd.to_datetime(r["exDate"], format="%d-%b-%Y", errors="coerce")
        if pd.notna(d):
            ex.setdefault(r["symbol"], []).append(d)
    events = set(rank.CORPORATE_EVENTS)
    for s, f in frames.items():
        if meta[s].get("benchmark") or s not in ex:
            continue
        gap = (f.open / f.close.shift(1) - 1).abs()
        for d in gap.index[gap > GAP]:
            if any(abs((d - x).days) <= EVENT_DAYS for x in ex[s]):
                events.add((s, d.date().isoformat()))
    return sorted(events)


def load(root=ROOT):
    frames, meta, quality, data_hash = load_candles(root)
    events = corporate_events(frames, meta, root)
    rank.CORPORATE_EVENTS = events  # read by ml.rank.build_panel at call time; v4's own runs are unaffected
    log(f"{sum(not m.get('benchmark') for m in meta.values())} stocks, {len(events)} corporate events excluded")
    return frames, meta, data_hash, events


def shrink(d):
    """float64 inputs to float32 to fit the twenty-year panel in memory."""
    for c in d.columns:
        if d[c].dtype == np.float64 and not c.startswith(("fwd", "bench", "future", "normal", "excess")):
            d[c] = d[c].astype(np.float32)
    return d


def keep(d, families, extra):
    """Only the columns fitting and scoring read, so the twenty-year frame fits in memory."""
    cols = ["symbol", "date", "labelEnd", "mkt_trend_200"] + extra + [c for f in families.values() for c in f["features"]]
    return d[list(dict.fromkeys(c for c in cols if c in d.columns))].copy()


def risk_data(frames, meta, root=ROOT):
    log("building the risk panel")
    long = risk.risk_panel(frames, meta, root)
    lr = long.x_lr_vol20
    long["w_sector_vol_rel"] = lr - lr.groupby([long.date, long.sector]).transform("median")
    long["w_cs_vol_rank"] = lr.groupby(long.date).rank(pct=True) - .5
    long["w_stress_breadth"] = (lr > 0).astype(float).where(lr.notna()).groupby(long.date).transform("mean")
    d = keep(risk.risk_frame(shrink(long)), RISK_FAMILIES, ["y", "future_vol", "normal_vol", "future_vs_normal", "vol_vs_normal"])
    del long
    gc.collect()
    log(f"risk rows {len(d):,}, sessions {d.date.nunique()}, stocks {d.symbol.nunique()}")
    return d


def rank_data(frames, meta, h=20):
    log("building the ranking panel")
    long = rank.build_panel(frames, meta)
    cal = frames[rank.CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    C = pd.DataFrame({s: frames[s].close.reindex(cal) for s in stocks})
    r120 = (C / C.shift(120) - 1).replace([np.inf, -np.inf], np.nan)
    sectors = pd.Series({s: meta[s].get("sector") or "OTHER" for s in stocks})
    rel = pd.DataFrame(np.nan, index=cal, columns=stocks)
    for cols in sectors.groupby(sectors).groups.values():
        sub = r120[list(cols)]
        total, count = sub.sum(axis=1, min_count=1), sub.notna().sum(axis=1)
        with np.errstate(divide="ignore", invalid="ignore"):
            peers = (total.to_numpy()[:, None] - sub.to_numpy()) / (count.to_numpy()[:, None] - 1)
        peers[count.to_numpy() < 3] = np.nan
        rel[list(cols)] = sub.to_numpy() - peers
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    raw = rel.stack(future_stack=True).reindex(idx).to_numpy()
    long["cs_rel_sector_120"] = pd.Series(raw, index=long.index).groupby(long.date).rank(pct=True) - .5
    d = keep(rank.horizon_frame(shrink(long), h), RANK_FAMILIES,
             ["y_peer", "fwd", "excess", f"bench_{h}"] + [c for c, _ in rank.FACTORS.values()])
    del long
    gc.collect()
    log(f"ranking h={h} rows {len(d):,}, sessions {d.date.nunique()}, stocks {d.symbol.nunique()}")
    return d


def split(d):
    dev = d.loc[(d.date < HOLDOUT_START) & (d.labelEnd < HOLDOUT_START)]
    dates = np.array(sorted(dev.date.unique()))
    starts = [dates[int(len(dates) * q)] for q in FOLD_POINTS] + [HOLDOUT_START]
    return dev, d.loc[d.date >= HOLDOUT_START], starts


# ------------------------------------------------------------------ models

def fit(kind, model, train, features, gbm, y):
    target = train[y].to_numpy()
    if model == "persistence":
        return {"kind": "persistence", "m": LogisticRegression(C=1., max_iter=500).fit(np.log(train[["vol_vs_normal"]].astype(float)).fillna(0), target)}
    if model in rank.FACTORS:
        column, sign = rank.FACTORS[model]
        return {"kind": "factor", "column": column, "sign": sign, "m": LogisticRegression(C=1., max_iter=500).fit((sign * train[column]).fillna(0).to_frame(), target)}
    out = {"kind": "model", "features": features, "models": {}}
    if model in ("logistic", "ensemble"):
        out["models"]["logistic"] = make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True), StandardScaler(),
                                                  LogisticRegression(C=.05, max_iter=1000)).fit(train[features], target)
    if model in ("gbm", "ensemble"):
        out["models"]["gbm"] = HistGradientBoostingClassifier(**gbm, early_stopping=False, random_state=SEED).fit(train[features], target)
    return out


def predict(fitted, frame):
    if fitted["kind"] == "persistence":
        return fitted["m"].predict_proba(np.log(frame[["vol_vs_normal"]].astype(float)).fillna(0))[:, 1]
    if fitted["kind"] == "factor":
        return fitted["m"].predict_proba((fitted["sign"] * frame[fitted["column"]]).fillna(0).to_frame())[:, 1]
    return np.mean([m.predict_proba(frame[fitted["features"]])[:, 1] for m in fitted["models"].values()], axis=0)


def candidates(families):
    seen = set()
    for family, spec in families.items():
        for model in spec["models"]:
            if model in rank.FACTORS and model in seen:
                continue
            seen.add(model)
            yield family, model, spec


def complexity(family, model, families):
    names = list(families)
    return (len(families[family]["features"]) if model not in rank.FACTORS and model != "persistence" else 0, names.index(family), MODEL_ORDER.index(model))


def walk(dev, starts, family, model, spec, kind):
    y = "y" if kind == "risk" else "y_peer"
    folds, oof = [], []
    for start, end in zip(starts[:-1], starts[1:]):
        tr = dev.loc[dev.labelEnd < start]
        va = dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
        p = predict(fit(kind, model, tr, spec["features"], spec["gbm"], y), va)
        m = rank.classification(va[y], p)
        m["meanIC"] = float(rank.daily_ic(va, p).mean()) if kind == "rank" else None
        folds.append({"validationStart": va.date.min().date().isoformat(), "validationEnd": va.date.max().date().isoformat(), "trainingSamples": int(len(tr)), **m})
        oof.append(pd.Series(p, index=va.index))
    score = "auc" if kind == "risk" else "meanIC"
    return {"family": family, "model": model, "folds": folds, "mean": float(np.mean([f[score] for f in folds]))}, pd.concat(oof)


def choose(results, families):
    best = max(r["mean"] for r in results)
    tied = [r for r in results if r["mean"] >= best - TIE]
    return min(tied, key=lambda r: complexity(r["family"], r["model"], families))


# ------------------------------------------------------------------ commands

def dev(kind):
    frames, meta, data_hash, events = load()
    d = risk_data(frames, meta) if kind == "risk" else rank_data(frames, meta)
    del frames
    dv, _, starts = split(d)
    dv = dv.copy()
    del d  # holdout rows are gone before any model is fitted
    gc.collect()
    families = RISK_FAMILIES if kind == "risk" else RANK_FAMILIES
    results = []
    for family, model, spec in candidates(families):
        t = time.time()
        r, _ = walk(dv, starts, family, model, spec, kind)
        r["minutes"] = round((time.time() - t) / 60, 1)
        results.append(r)
        log(f"{family:<7} {model:<15} mean {'AUC' if kind == 'risk' else 'IC '} {r['mean']:.4f}  ({r['minutes']} min)")
        atomic_json(ROOT / "reports" / f"wide-dev-{kind}.json", {"generatedAt": utcnow(), "kind": kind, "dataHash": data_hash, "complete": False, "results": results})
    pick = choose(results, families)
    report = {"generatedAt": utcnow(), "kind": kind, "dataHash": data_hash, "complete": True, "protocol": "ml/WIDE_PROTOCOL.md amendment 1",
              "holdoutStart": HOLDOUT_START.date().isoformat(), "development": {"start": dv.date.min().date().isoformat(), "end": dv.date.max().date().isoformat(),
              "rows": int(len(dv)), "stocks": int(dv.symbol.nunique())}, "foldStarts": [pd.Timestamp(s).date().isoformat() for s in starts],
              "corporateEvents": len(events), "results": results, "selected": {"family": pick["family"], "model": pick["model"], "mean": pick["mean"]},
              "unchangedMethod": max((r for r in results if r["family"] in ("R-v4", "K-v2")), key=lambda r: r["mean"])}
    atomic_json(ROOT / "reports" / f"wide-dev-{kind}.json", report)
    log(f"selected {pick['family']} {pick['model']} ({pick['mean']:.4f})")


def rolling(d, holdout, family, model, spec, kind):
    y = "y" if kind == "risk" else "y_peer"
    dates = np.array(sorted(holdout.date.unique()))
    parts = []
    for i in range(0, len(dates), rank.REFIT_EVERY):
        start = dates[i]
        end = dates[i + rank.REFIT_EVERY] if i + rank.REFIT_EVERY < len(dates) else None
        tr = d.loc[d.labelEnd < start]
        block = holdout.loc[(holdout.date >= start) & ((holdout.date < end) if end is not None else True)]
        parts.append(pd.Series(predict(fit(kind, model, tr, spec["features"], spec["gbm"], y), block), index=block.index))
    return pd.concat(parts).reindex(holdout.index).to_numpy()


def score_final(kind, d, chosen, families):
    dev_rows, holdout, starts = split(d)
    y = "y" if kind == "risk" else "y_peer"
    out = {}
    for label, pick in chosen.items():
        spec = families[pick["family"]]
        _, oof = walk(dev_rows, starts, pick["family"], pick["model"], spec, kind)
        calibrator = LogisticRegression(C=1.).fit(rank.logit(oof.to_numpy()), dev_rows.loc[oof.index, y])
        p = rank.calibrate(calibrator, rolling(d, holdout, pick["family"], pick["model"], spec, kind))
        if kind == "risk":
            e = risk.evaluate(holdout, p)
            e["auc"] = float(roc_auc_score(holdout.y, p))
            e["tiers"] = risk.tiers(holdout, p)
        else:
            e = rank.evaluate(holdout, p, "peer", 20)
            e["portfolio"] = rank.portfolio(holdout, p, 20)
            e["quintiles"] = rank.quintiles(holdout, p)
        out[label] = {"family": pick["family"], "model": pick["model"], "holdout": e}
        if label == "selected":
            cols = ["symbol", "date", "labelEnd", y] + (["future_vol", "normal_vol"] if kind == "risk" else ["fwd", "excess"])
            frame = holdout[cols].copy()
            frame["probability"] = p
            frame.to_csv(ROOT / "reports" / f"wide-holdout-{kind}.csv", index=False)
            out[label]["predictions"] = frame
        log(f"{kind} {label}: {pick['family']} {pick['model']} -> " + (f"AUC {e['auc']:.4f}" if kind == "risk" else f"IC {e['ranking']['meanIC']:.4f}"))
    return out


def final():
    reports = {k: json.loads((ROOT / "reports" / f"wide-dev-{k}.json").read_text(encoding="utf-8")) for k in ("risk", "rank")}
    if not all(r.get("complete") for r in reports.values()):
        raise SystemExit("Both development runs must finish before the final evaluation")
    if (ROOT / "reports" / "wide-final.json").exists():
        raise SystemExit("The final evaluation has already run; the holdout is scored once")
    frames, meta, data_hash, events = load()
    result = {"generatedAt": utcnow(), "protocol": "ml/WIDE_PROTOCOL.md amendment 1", "dataHash": data_hash, "holdoutStart": HOLDOUT_START.date().isoformat()}
    d = risk_data(frames, meta)
    picks = {"selected": reports["risk"]["selected"], "unchangedMethod": reports["risk"]["unchangedMethod"]}
    riskres = score_final("risk", d, picks, RISK_FAMILIES)
    del d
    gc.collect()
    d = rank_data(frames, meta)
    picks = {"selected": reports["rank"]["selected"], "unchangedMethod": reports["rank"]["unchangedMethod"]}
    rankres = score_final("rank", d, picks, RANK_FAMILIES)
    del d, frames
    gc.collect()

    # Gate 2: the wide model versus v4's saved holdout predictions on the stock-dates both cover.
    core = json.loads((CORE / "reports" / "risk-latest.json").read_text(encoding="utf-8"))
    v4 = pd.read_csv(CORE / "models" / core["modelVersion"] / "holdout-risk.csv", parse_dates=["date"])
    wide = riskres["selected"].pop("predictions")
    riskres["unchangedMethod"].pop("predictions", None)
    rankres["selected"].pop("predictions", None)
    rankres["unchangedMethod"].pop("predictions", None)
    shared = v4.merge(wide, on=["symbol", "date"], suffixes=("_v4", "_wide"))
    shared = shared.loc[shared.y_v4 == shared.y_wide]
    v4_auc, wide_auc = float(roc_auc_score(shared.y_v4, shared.probability_v4)), float(roc_auc_score(shared.y_wide, shared.probability_wide))
    sel_risk, sel_rank = riskres["selected"]["holdout"], rankres["selected"]["holdout"]
    ci = sel_rank["ranking"]["meanICConfidenceInterval"]
    g1 = sel_risk["auc"] >= .779
    g2 = wide_auc >= v4_auc - .005
    g3 = bool(ci and ci["lower"] > 0 and sel_rank["portfolio"]["annualExcessVsUniverse"] > 0)
    result.update({"risk": riskres, "rank": rankres,
                   "gates": {"gate1RiskWide": {"auc": sel_risk["auc"], "floor": .779, "passed": bool(g1)},
                             "gate2RiskCore": {"sharedStockDates": int(len(shared)), "sharedStocks": int(shared.symbol.nunique()), "v4Auc": v4_auc, "wideAuc": wide_auc, "passed": bool(g2)},
                             "gate3Rank20": {"meanIC": sel_rank["ranking"]["meanIC"], "meanICConfidenceInterval": ci,
                                             "annualExcessVsUniverse": sel_rank["portfolio"]["annualExcessVsUniverse"], "passed": g3}},
                   "outcome": "wide shadow account" if g1 and g2 and g3 else "wide risk tiers only" if g1 and g2 else "not used"})
    atomic_json(ROOT / "reports" / "wide-final.json", result)
    log(json.dumps(result["gates"], indent=1))
    log(f"outcome: {result['outcome']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["dev", "final"])
    parser.add_argument("kind", nargs="?", choices=["risk", "rank"])
    args = parser.parse_args()
    if args.command == "dev":
        if not args.kind:
            raise SystemExit("dev needs risk or rank")
        dev(args.kind)
    else:
        final()


if __name__ == "__main__":
    main()
