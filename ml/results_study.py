"""v5 research: do the numbers in quarterly results improve the live models?

Run: python -m ml.results_study --data-dir data/pulse
     python -m ml.results_study --timing xbrl   (diagnostic: XBRL dissemination time only)

Inputs: ml.results_features (revenue, profit and EPS growth, a profit surprise proxy,
revenue acceleration, margin change, freshness), from NSE results XBRL filings
collected by ml.results_history. Volatility (pulse-risk-v4) gets the raw inputs;
ranking (pulse-rank-v2) gets their daily cross-sectional ranks, like its other inputs.

Development walk-forward folds only (ml.rank.split_dates), exactly as ml.v5_study.
Gate fixed before running: +0.005 mean AUC (volatility) or mean rank IC (ranking, 5
and 20 sessions) and better in >= 3 of 4 folds, per model. The holdout is not used
unless a configuration passes. The decision uses the default (announcement) timing;
XBRL filings exist from mid-2018, so earlier rows carry missing (imputed) inputs and
an availability flag.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import ml.rank as rank
import ml.risk as risk
from ml.disclosure_features import load_meetings
from ml.news_study import load_disclosures
from ml.pulse import atomic_json, load_candles, utcnow
from ml.results_features import FEATURES as RESULTS, RANKED, add_results_features
from ml.v5_study import gate


def coverage(dev, starts, column="res_available"):
    return [float(dev.loc[(dev.date >= a) & (dev.date < b), column].mean()) for a, b in zip(starts[:-1], starts[1:])]


def study(data_dir, timing="announcement"):
    root = Path(data_dir)
    frames, meta, _, _ = load_candles(root)
    cal = frames[risk.CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    disclosures, meetings = load_disclosures(root), load_meetings(root)
    out = {"generatedAt": utcnow(), "timing": timing,
           "gate": "+0.005 mean metric and better in >= 3 of 4 development folds", "volatility": [], "ranking": []}

    long = risk.risk_panel(frames, meta, root)
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    add_results_features(long, root, cal, stocks, lambda f: f.stack(future_stack=True).reindex(idx).to_numpy(),
                         disclosures, timing, meetings=meetings)
    d = risk.risk_frame(long)
    dev, _, starts = rank.split_dates(d)
    out["foldStarts"] = [pd.Timestamp(s).date().isoformat() for s in starts]
    out["resultsCoverageByFold"] = coverage(dev, starts)
    out["trainingCoverageByFold"] = [float(dev.loc[dev.labelEnd < s, "res_available"].mean()) for s in starts[:-1]]
    print("coverage", [round(c, 3) for c in out["resultsCoverageByFold"]], "training", [round(c, 3) for c in out["trainingCoverageByFold"]], flush=True)
    base = list(risk.FEATURES)
    results = {}
    for label, feats in (("v4", base), ("v4+results", base + RESULTS)):
        risk.FEATURES = feats
        for model in ("logistic", "ensemble"):
            folds = []
            for start, end in zip(starts[:-1], starts[1:]):
                tr, va = dev.loc[dev.labelEnd < start], dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
                folds.append(risk.auc(va.y, risk.predict(risk.fit(model, tr), va)))
            results[(label, model)] = folds
            out["volatility"].append({"features": label, "model": model, "meanAUC": float(np.mean(folds)), "folds": [round(f, 4) for f in folds]})
            print("vol", label, model, round(float(np.mean(folds)), 4), [round(f, 4) for f in folds], flush=True)
    risk.FEATURES = base
    for model in ("logistic", "ensemble"):
        passed, better = gate(results[("v4", model)], results[("v4+results", model)])
        out.setdefault("volatilityGate", {})[model] = {"passed": passed, "foldsBetter": better}
    del long, d, dev

    panel = rank.build_panel(frames, meta)
    pidx = pd.MultiIndex.from_arrays([panel.date, panel.symbol])
    add_results_features(panel, root, cal, stocks, lambda f: f.stack(future_stack=True).reindex(pidx).to_numpy(),
                         disclosures, timing, meetings=meetings)
    cs = []
    for k in RANKED:  # cross-sectional ranks, matching the ranking model's other inputs
        panel[f"cs_{k}"] = panel.groupby("date")[k].rank(pct=True) - .5
        cs.append(f"cs_{k}")
    rbase = list(rank.FEATURES)
    for h in (5, 20):
        dh = rank.horizon_frame(panel, h)
        devh, _, sh = rank.split_dates(dh)
        res = {}
        for label, feats in (("v2", rbase), ("v2+results", rbase + cs + ["res_available"])):
            rank.FEATURES = feats
            for model in ("logistic", "ensemble"):
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
        for model in ("logistic", "ensemble"):
            passed, better = gate(res[("v2", model)], res[("v2+results", model)])
            out.setdefault("rankingGate", {})[f"{h}:{model}"] = {"passed": passed, "foldsBetter": better}
    atomic_json(root / "reports" / ("results-study-dev.json" if timing == "announcement" else f"results-study-dev-{timing}.json"), out)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--timing", choices=["announcement", "xbrl"], default="announcement")
    args = parser.parse_args()
    out = study(args.data_dir, args.timing)
    print(json.dumps({"coverage": out["resultsCoverageByFold"], "volatilityGate": out["volatilityGate"], "rankingGate": out["rankingGate"]}))


if __name__ == "__main__":
    main()
