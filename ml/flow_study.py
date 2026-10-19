"""v5 research: do NSE delivery and bulk/block-deal flows improve the live models?

Run: python -m ml.flow_study dev --data-dir data/pulse        (development folds only)
     python -m ml.flow_study holdout --data-dir data/pulse    (only configurations that passed; scored once)

Inputs: ml.flow_features (delivery share and its change versus the stock's own
20/60-session norm, abnormal delivered quantity, recent bulk/block deal counts and
net direction). Volatility adds them raw to pulse-risk-v4; ranking adds their
same-date cross-sectional ranks to pulse-rank-v2.

Gate, fixed before running, as in ml.v5_study: on the four development walk-forward
folds of ml.rank.split_dates, +0.005 mean AUC (volatility) or mean daily rank IC
(ranking, 5 and 20 sessions), and better in at least 3 of 4 folds, for logistic and
for the logistic/GBM ensemble separately. The holdout is scored only for passing
configurations, once: a second holdout run refuses to overwrite the first.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

import ml.rank as rank
import ml.risk as risk
from ml.flow_features import FEATURES as FLOW, STOCK, add_flow_features
from ml.pulse import atomic_json, load_candles, utcnow
from ml.v5_study import gate

MODELS = ("logistic", "ensemble")
CS = [f"cs_{k}" for k in STOCK]


def panels(root):
    frames, meta, _, data_hash = load_candles(root)
    cal = frames[risk.CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    long = risk.risk_panel(frames, meta, root)
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    add_flow_features(long, root, cal, stocks, lambda f: f.stack(future_stack=True).reindex(idx).to_numpy())
    panel = rank.build_panel(frames, meta)
    pidx = pd.MultiIndex.from_arrays([panel.date, panel.symbol])
    add_flow_features(panel, root, cal, stocks, lambda f: f.stack(future_stack=True).reindex(pidx).to_numpy(), ranks=True)
    return risk.risk_frame(long), panel, data_hash


def coverage(d, starts):
    return [{"start": pd.Timestamp(a).date().isoformat(),
             "delivery": float(d.loc[(d.date >= a) & (d.date < b), "fl_has_delivery"].mean()),
             "deals": float(d.loc[(d.date >= a) & (d.date < b), "fl_bulk_n20"].notna().mean()),
             "anyDeal20": float((d.loc[(d.date >= a) & (d.date < b), "fl_bulk_n20"].fillna(0)
                                 + d.loc[(d.date >= a) & (d.date < b), "fl_block_n20"].fillna(0) > 0).mean())}
            for a, b in zip(starts[:-1], starts[1:])]


def study(data_dir):
    root = Path(data_dir)
    d, panel, data_hash = panels(root)
    out = {"generatedAt": utcnow(), "dataHash": data_hash, "gate": "+0.005 mean metric and better in >= 3 of 4 development folds",
           "volatility": [], "ranking": []}
    dev, _, starts = rank.split_dates(d)
    out["foldStarts"] = [pd.Timestamp(s).date().isoformat() for s in starts]
    out["coverageByFold"] = coverage(dev, starts)
    print("coverage", out["coverageByFold"], flush=True)
    base = list(risk.FEATURES)
    results = {}
    for label, feats in (("v4", base), ("v4+flow", base + FLOW)):
        risk.FEATURES = feats
        for model in MODELS:
            folds = []
            for start, end in zip(starts[:-1], starts[1:]):
                tr, va = dev.loc[dev.labelEnd < start], dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
                folds.append(risk.auc(va.y, risk.predict(risk.fit(model, tr), va)))
            results[(label, model)] = folds
            out["volatility"].append({"features": label, "model": model, "meanAUC": float(np.mean(folds)), "folds": [round(f, 4) for f in folds]})
            print("vol", label, model, round(float(np.mean(folds)), 4), [round(f, 4) for f in folds], flush=True)
    risk.FEATURES = base
    for model in MODELS:
        passed, better = gate(results[("v4", model)], results[("v4+flow", model)])
        out.setdefault("volatilityGate", {})[model] = {"passed": passed, "foldsBetter": better,
                                                       "gain": float(np.mean(results[("v4+flow", model)]) - np.mean(results[("v4", model)]))}

    rbase = list(rank.FEATURES)
    for h in (5, 20):
        devh, _, sh = rank.split_dates(rank.horizon_frame(panel, h))
        res = {}
        for label, feats in (("v2", rbase), ("v2+flow", rbase + CS)):
            rank.FEATURES = feats
            for model in MODELS:
                ics, accs = [], []
                for start, end in zip(sh[:-1], sh[1:]):
                    tr, va = devh.loc[devh.labelEnd < start], devh.loc[(devh.date >= start) & (devh.labelEnd < end)]
                    p = rank.predict(rank.fit(model, tr, "peer"), va)
                    ics.append(float(rank.daily_ic(va, p).mean()))
                    accs.append(float(((p >= .5) == va.y_peer).mean()))
                res[(label, model)] = ics
                out["ranking"].append({"horizon": h, "features": label, "model": model, "meanIC": float(np.mean(ics)),
                                       "folds": [round(x, 4) for x in ics], "meanAccuracy": float(np.mean(accs))})
                print("rank", h, label, model, round(float(np.mean(ics)), 4), [round(x, 4) for x in ics], round(float(np.mean(accs)), 4), flush=True)
        rank.FEATURES = rbase
        for model in MODELS:
            passed, better = gate(res[("v2", model)], res[("v2+flow", model)])
            out.setdefault("rankingGate", {})[f"{h}:{model}"] = {"passed": passed, "foldsBetter": better,
                                                                 "gain": float(np.mean(res[("v2+flow", model)]) - np.mean(res[("v2", model)]))}
    atomic_json(root / "reports" / "flow-study-dev.json", out)
    return out


def score_holdout(data_dir):
    """Holdout for configurations that passed the development gate, scored once."""
    root = Path(data_dir)
    target = root / "reports" / "flow-study-holdout.json"
    if target.exists():
        raise SystemExit(f"{target} exists: the holdout has already been scored once")
    dev_report = json.loads((root / "reports" / "flow-study-dev.json").read_text(encoding="utf-8"))
    vol = [m for m, g in dev_report["volatilityGate"].items() if g["passed"]]
    rk = [k for k, g in dev_report["rankingGate"].items() if g["passed"]]
    if not vol and not rk:
        raise SystemExit("no configuration passed the development gate; the holdout is not scored")
    d, panel, data_hash = panels(root)
    if data_hash != dev_report["dataHash"]:
        print("warning: candle data changed since the development run", flush=True)
    out = {"generatedAt": utcnow(), "dataHash": data_hash, "volatility": {}, "ranking": {}}
    dev, hold, starts = rank.split_dates(d)
    base = list(risk.FEATURES)
    for model in vol:
        for label, feats in (("v4", base), ("v4+flow", base + FLOW)):
            risk.FEATURES = feats
            preds = []
            for start, end in zip(starts[:-1], starts[1:]):
                tr, va = dev.loc[dev.labelEnd < start], dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
                preds.append(pd.Series(risk.predict(risk.fit(model, tr), va), index=va.index))
            oof = pd.concat(preds)
            calibrator = LogisticRegression(C=1.).fit(rank.logit(oof.to_numpy()), dev.loc[oof.index].y)
            dates = np.array(sorted(hold.date.unique()))
            parts = []
            for i in range(0, len(dates), rank.REFIT_EVERY):
                start = dates[i]
                end = dates[i + rank.REFIT_EVERY] if i + rank.REFIT_EVERY < len(dates) else None
                block = hold.loc[(hold.date >= start) & ((hold.date < end) if end is not None else True)]
                parts.append(pd.Series(risk.predict(risk.fit(model, d.loc[d.labelEnd < start]), block), index=block.index))
            p = rank.calibrate(calibrator, pd.concat(parts).reindex(hold.index).to_numpy())
            res = risk.evaluate(hold, p)
            res.update({"auc": risk.auc(hold.y, p), "selective": rank.selective(hold.y.to_numpy(), p), "tiers": risk.tiers(hold, p)})
            out["volatility"][f"{label} / {model}"] = res
            print(f"holdout vol {label} / {model}: acc={res['accuracy']:.4f} auc={res['auc']:.4f}", flush=True)
    risk.FEATURES = base
    rbase = list(rank.FEATURES)
    for key in rk:
        h, model = int(key.split(":")[0]), key.split(":")[1]
        dh = rank.horizon_frame(panel, h)
        _, holdh, _ = rank.split_dates(dh)
        for label, feats in (("v2", rbase), ("v2+flow", rbase + CS)):
            rank.FEATURES = feats
            p, _ = rank.rolling_holdout(dh, holdh, model, "peer")
            ic = rank.daily_ic(holdh, p)
            out["ranking"][f"{h}:{label} / {model}"] = {"meanIC": float(ic.mean()), "icSummary": rank.ic_summary(ic, h),
                                                         "accuracy": float(((p >= .5) == holdh.y_peer).mean())}
            print(f"holdout rank {h} {label} / {model}: ic={ic.mean():+.4f}", flush=True)
    rank.FEATURES = rbase
    atomic_json(target, out)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["dev", "holdout"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    if args.command == "dev":
        out = study(args.data_dir)
        print(json.dumps({"volatilityGate": out["volatilityGate"], "rankingGate": out["rankingGate"]}))
    else:
        score_holdout(args.data_dir)


if __name__ == "__main__":
    main()
