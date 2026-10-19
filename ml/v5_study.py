"""v5 research: do global, commodity and currency inputs improve the live models?

Run: python -m ml.v5_study --data-dir data/pulse

Development walk-forward folds only (ml.rank.split_dates); the holdout is not used.
Gates fixed before running: volatility +0.005 mean AUC and better in >= 3 of 4 folds;
ranking +0.005 mean rank IC and better in >= 3 of 4 folds. Global history starts in
April 2020, so earlier rows carry missing (imputed) global inputs.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import ml.rank as rank
import ml.risk as risk
from ml.global_features import EXPOSURE, FEATURES as GLOBAL, MARKET, add_global_features
from ml.pulse import atomic_json, load_candles, utcnow

GATE = .005


MIN_TRAIN = 20000


def gate(base, new):
    # Better in at least 75% of evaluated folds (3 of 4, or 3 of 3 when a fold has no training data).
    better = sum(n > b for n, b in zip(new, base))
    return bool(np.mean(new) - np.mean(base) >= GATE and better >= int(np.ceil(.75 * len(base)))), better


def study(data_dir, since=None):
    root = Path(data_dir)
    frames, meta, _, _ = load_candles(root)
    cal = frames[risk.CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    closes = pd.DataFrame({s: frames[s].close.reindex(cal) for s in stocks})
    out = {"generatedAt": utcnow(), "gate": "+0.005 mean metric and better in >= 3 of 4 development folds", "volatility": [], "ranking": []}

    long = risk.risk_panel(frames, meta, root)
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    pick = lambda f: f.stack(future_stack=True).reindex(idx).to_numpy()
    add_global_features(long, root, cal, stocks, closes, pick)
    d = risk.risk_frame(long)
    dev, _, starts = rank.split_dates(d)
    if since:  # second attempt: both arms trained only where global inputs exist
        dev = dev.loc[dev.date >= pd.Timestamp(since)]
        out["trainingSince"] = since
    out["foldStarts"] = [pd.Timestamp(s).date().isoformat() for s in starts]
    out["globalCoverageByFold"] = [float(dev.loc[(dev.date >= a) & (dev.date < b), "g_sp_ret20"].notna().mean()) for a, b in zip(starts[:-1], starts[1:])]
    base = list(risk.FEATURES)
    results = {}
    for label, feats in (("v4", base), ("v4+global", base + GLOBAL)):
        risk.FEATURES = feats
        for model in ("logistic", "ensemble"):
            folds = []
            for start, end in zip(starts[:-1], starts[1:]):
                tr, va = dev.loc[dev.labelEnd < start], dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
                if len(tr) < MIN_TRAIN:  # only in the second attempt: no training rows before this fold
                    continue
                folds.append(risk.auc(va.y, risk.predict(risk.fit(model, tr), va)))
            results[(label, model)] = folds
            out["volatility"].append({"features": label, "model": model, "meanAUC": float(np.mean(folds)), "folds": [round(f, 4) for f in folds]})
            print("vol", label, model, round(float(np.mean(folds)), 4), [round(f, 4) for f in folds], flush=True)
    risk.FEATURES = base
    for model in ("logistic", "ensemble"):
        passed, better = gate(results[("v4", model)], results[("v4+global", model)])
        out.setdefault("volatilityGate", {})[model] = {"passed": passed, "foldsBetter": better}

    panel = rank.build_panel(frames, meta)
    pidx = pd.MultiIndex.from_arrays([panel.date, panel.symbol])
    add_global_features(panel, root, cal, stocks, closes, lambda f: f.stack(future_stack=True).reindex(pidx).to_numpy())
    cs = []
    for k in EXPOSURE:  # cross-sectional ranks, matching the ranking model's other inputs
        panel[f"cs_{k}"] = panel.groupby("date")[k].rank(pct=True) - .5
        cs.append(f"cs_{k}")
    rbase = list(rank.FEATURES)
    for h in (5, 20):
        dh = rank.horizon_frame(panel, h)
        devh, _, sh = rank.split_dates(dh)
        if since:
            devh = devh.loc[devh.date >= pd.Timestamp(since)]
        res = {}
        for label, feats in (("v2", rbase), ("v2+global", rbase + cs + MARKET)):
            rank.FEATURES = feats
            for model in ("logistic", "ensemble"):
                ics, accs = [], []
                for start, end in zip(sh[:-1], sh[1:]):
                    tr, va = devh.loc[devh.labelEnd < start], devh.loc[(devh.date >= start) & (devh.labelEnd < end)]
                    if len(tr) < MIN_TRAIN:
                        continue
                    p = rank.predict(rank.fit(model, tr, "peer"), va)
                    ics.append(float(rank.daily_ic(va, p).mean()))
                    accs.append(float(((p >= .5) == va.y_peer).mean()))
                res[(label, model)] = ics
                out["ranking"].append({"horizon": h, "features": label, "model": model, "meanIC": float(np.mean(ics)),
                                       "folds": [round(x, 4) for x in ics], "meanAccuracy": float(np.mean(accs))})
                print("rank", h, label, model, round(float(np.mean(ics)), 4), [round(x, 4) for x in ics], round(float(np.mean(accs)), 4), flush=True)
        rank.FEATURES = rbase
        for model in ("logistic", "ensemble"):
            passed, better = gate(res[("v2", model)], res[("v2+global", model)])
            out.setdefault("rankingGate", {})[f"{h}:{model}"] = {"passed": passed, "foldsBetter": better}
    atomic_json(root / "reports" / (f"v5-study-dev-since-{since}.json" if since else "v5-study-dev.json"), out)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--since", help="train and validate only on dates from this day (second attempt)")
    args = parser.parse_args()
    out = study(args.data_dir, args.since)
    print(json.dumps({"coverage": out["globalCoverageByFold"], "volatilityGate": out["volatilityGate"], "rankingGate": out["rankingGate"]}))


if __name__ == "__main__":
    main()
