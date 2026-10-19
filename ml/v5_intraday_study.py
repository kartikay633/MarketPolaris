"""pulse-risk-v5 study: intraday, panic/dip and option-surface inputs against v4.

Run: python -m ml.v5_intraday_study --data-dir data/pulse              (development folds only)
     python -m ml.v5_intraday_study --data-dir data/pulse --holdout    (adds the one-time holdout, only if the gate passed)

The protocol (arms, folds, gate, holdout rule) is ml/V5_PROTOCOL.md, committed before any result.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

import ml.risk as risk
from ml.pulse import atomic_json, load_candles, utcnow
from ml.rank import REFIT_EVERY, calibrate, classification, logit, selective, split_dates
from ml.v5_features import INTRADAY, PANIC, SURFACE, add_intraday_features, add_surface_features

FOLD_STARTS = ["2023-01-02", "2023-04-03", "2023-07-03", "2023-10-03", "2024-01-01", "2024-04-01", "2024-07-01", "2024-10-01"]
GAIN, FOLDS_BETTER = .005, 6
MODELS = ("logistic", "ensemble")


def panel(root):
    frames, meta, _, data_hash = load_candles(root)
    cal = frames[risk.CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    closes = pd.DataFrame({s: frames[s].close.reindex(cal) for s in stocks})
    long = risk.risk_panel(frames, meta, root)
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    pick = lambda f: f.stack(future_stack=True).reindex(idx).to_numpy()
    print("Adding intraday and panic inputs...", flush=True)
    add_intraday_features(long, root, cal, stocks, closes, pick)
    print("Adding option-surface inputs...", flush=True)
    add_surface_features(long, root, cal, stocks, closes, pick)
    return risk.risk_frame(long), data_hash


def oof(dev, model, features):
    risk.FEATURES = features
    starts = [pd.Timestamp(s) for s in FOLD_STARTS] + [dev.date.max() + pd.Timedelta(days=1)]
    folds, preds = [], []
    for start, end in zip(starts[:-1], starts[1:]):
        tr = dev.loc[dev.labelEnd < start]
        va = dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
        p = risk.predict(risk.fit(model, tr), va)
        folds.append({"validationStart": start.date().isoformat(), "samples": int(len(va)), "auc": risk.auc(va.y, p),
                      "accuracy": float(((p >= .5) == va.y).mean()), "intradayCoverage": float(va.i_has.mean())})
        preds.append(pd.Series(p, index=va.index))
    return folds, pd.concat(preds)


def study(data_dir, holdout=False):
    root = Path(data_dir)
    d, data_hash = panel(root)
    dev, hold, _ = split_dates(d)
    base = list(risk.FEATURES)
    arms = {"A v4": base, "B v4+intraday+panic": base + INTRADAY + PANIC, "C v4+option surface": base + SURFACE,
            "D v4+all": base + INTRADAY + PANIC + SURFACE}
    report = {"generatedAt": utcnow(), "dataHash": data_hash, "protocol": "ml/V5_PROTOCOL.md", "foldStarts": FOLD_STARTS,
              "holdoutStart": hold.date.min().date().isoformat(),
              "coverage": {"intradayDevByYear": dev.groupby(dev.date.dt.year).i_has.mean().round(3).to_dict(),
                           "surfaceDevByYear": dev.groupby(dev.date.dt.year).s_has.mean().round(3).to_dict(),
                           "intradayHoldout": float(hold.i_has.mean())},
              "arms": []}
    results = {}
    for label, feats in arms.items():
        for model in MODELS:
            folds, pred = oof(dev, model, feats)
            rows = dev.loc[pred.index]
            calibrator = LogisticRegression(C=1.).fit(logit(pred.to_numpy()), rows.y)
            cp = calibrate(calibrator, pred.to_numpy())
            r = {"arm": label, "model": model, "meanAUC": float(np.mean([f["auc"] for f in folds])),
                 "foldAUC": [round(f["auc"], 4) for f in folds],
                 "meanAccuracy": float(np.average([f["accuracy"] for f in folds], weights=[f["samples"] for f in folds])),
                 "calibratedAccuracy": float(((cp >= .5) == rows.y).mean()), "selective": selective(rows.y.to_numpy(), cp),
                 "folds": folds}
            results[(label, model)] = (r, calibrator)
            report["arms"].append(r)
            print(f"  {label:<22} {model:<9} auc={r['meanAUC']:.4f} folds={r['foldAUC']} acc={r['calibratedAccuracy']:.4f}", flush=True)
    risk.FEATURES = base
    gates = []
    for label in list(arms)[1:]:
        for model in MODELS:
            a, b = results[("A v4", model)][0], results[(label, model)][0]
            better = int(sum(y > x for x, y in zip(a["foldAUC"], b["foldAUC"])))
            gain = b["meanAUC"] - a["meanAUC"]
            gates.append({"arm": label, "model": model, "gain": gain, "foldsBetter": better,
                          "passed": bool(gain >= GAIN and better >= FOLDS_BETTER)})
            print(f"  gate {label} / {model}: gain {gain:+.4f}, {better}/8 folds -> {'PASS' if gates[-1]['passed'] else 'fail'}", flush=True)
    report["gates"] = gates
    passed = [g for g in gates if g["passed"]]
    if holdout and passed:
        best = max(passed, key=lambda g: results[(g["arm"], g["model"])][0]["meanAUC"])
        report["holdout"] = {"candidate": f"{best['arm']} / {best['model']}"}
        for label, model in ((best["arm"], best["model"]), ("A v4", best["model"])):
            risk.FEATURES = arms[label]
            dates = np.array(sorted(hold.date.unique()))
            parts = []
            for i in range(0, len(dates), REFIT_EVERY):
                start = dates[i]
                end = dates[i + REFIT_EVERY] if i + REFIT_EVERY < len(dates) else None
                block = hold.loc[(hold.date >= start) & ((hold.date < end) if end is not None else True)]
                parts.append(pd.Series(risk.predict(risk.fit(model, d.loc[d.labelEnd < start]), block), index=block.index))
            p = calibrate(results[(label, model)][1], pd.concat(parts).reindex(hold.index).to_numpy())
            out = {**classification(hold.y, p), "auc": risk.auc(hold.y, p), "selective": selective(hold.y.to_numpy(), p),
                   "tiers": risk.tiers(hold, p)}
            report["holdout"][f"{label} / {model}"] = out
            print(f"  holdout {label} / {model}: acc={out['accuracy']:.4f} auc={out['auc']:.4f}", flush=True)
        risk.FEATURES = base
        v5o, v4o = report["holdout"][report["holdout"]["candidate"]], report["holdout"][f"A v4 / {best['model']}"]
        report["holdout"]["replacesV4"] = bool(v5o["auc"] - v4o["auc"] >= GAIN and v5o["accuracy"] >= v4o["accuracy"])
    elif holdout:
        print("holdout not scored: no arm passed the development gate", flush=True)
    atomic_json(root / "reports" / "v5-intraday-study.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--holdout", action="store_true")
    args = parser.parse_args()
    out = study(args.data_dir, args.holdout)
    print(json.dumps({"gates": out["gates"], "coverage": out["coverage"]}, default=str))


if __name__ == "__main__":
    main()
