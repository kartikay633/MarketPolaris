"""Development-fold test of Qwen tag features in pulse-risk-v4 and pulse-rank-v2 (5 sessions).

Gates fixed before running: volatility +0.005 mean AUC and better in >= 3 of 4 folds;
ranking +0.005 mean rank IC and better in >= 3 of 4 folds. Holdout is not touched here.
Usage: python ml/tags_study.py <data_dir>   (results recorded in ml/RESULTS.md)
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, os.getcwd())
import ml.rank as rank  # noqa: E402
import ml.risk as risk  # noqa: E402
from ml.disclosure_features import TAG_FEATURES, tag_features  # noqa: E402
from ml.news_study import load_disclosures  # noqa: E402
from ml.pulse import load_candles  # noqa: E402

root = Path(sys.argv[1])
frames, meta, _, _ = load_candles(root)
cal = frames[risk.CALENDAR].index
stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
tags = json.loads((root / "news-history" / "tags.json").read_text(encoding="utf-8"))["tags"]
wide = tag_features(load_disclosures(root), tags, cal, stocks)


def attach(long, ranked):
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    cols = []
    for k, v in wide.items():
        x = np.sign(v) * np.log1p(v.abs())  # sign-safe: net tone can be negative
        long[f"t_{k}"] = x.stack(future_stack=True).reindex(idx).to_numpy()
        cols.append(f"t_{k}")
        if ranked:  # cross-sectional rank, matching the ranking model's other inputs
            long[f"cs_t_{k}"] = (x.rank(axis=1, pct=True) - .5).stack(future_stack=True).reindex(idx).to_numpy()
            cols.append(f"cs_t_{k}")
    return cols


out = {"volatility": [], "ranking": []}
# ---- volatility (pulse-risk-v4 inputs)
long = risk.risk_panel(frames, meta, root)
tcols = attach(long, ranked=False)
d = risk.risk_frame(long)
dev, _, starts = rank.split_dates(d)
base = list(risk.FEATURES)
for label, feats in (("v4", base), ("v4+tags", base + tcols)):
    risk.FEATURES = feats
    for model in ("logistic", "ensemble"):
        folds = []
        for start, end in zip(starts[:-1], starts[1:]):
            tr, va = dev.loc[dev.labelEnd < start], dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
            folds.append(risk.auc(va.y, risk.predict(risk.fit(model, tr), va)))
        row = {"features": label, "model": model, "meanAUC": float(np.mean(folds)), "folds": [round(f, 4) for f in folds]}
        out["volatility"].append(row)
        print("vol", json.dumps(row), flush=True)
risk.FEATURES = base

# ---- ranking, 5 sessions (pulse-rank-v2 inputs, peer target)
panel = rank.build_panel(frames, meta)
rcols = [c for c in attach(panel, ranked=True) if c.startswith("cs_")]
d5 = rank.horizon_frame(panel, 5)
dev5, _, starts5 = rank.split_dates(d5)
rbase = list(rank.FEATURES)
for label, feats in (("v2", rbase), ("v2+tags", rbase + rcols)):
    rank.FEATURES = feats
    for model in ("logistic", "ensemble"):
        folds, accs = [], []
        for start, end in zip(starts5[:-1], starts5[1:]):
            tr, va = dev5.loc[dev5.labelEnd < start], dev5.loc[(dev5.date >= start) & (dev5.labelEnd < end)]
            p = rank.predict(rank.fit(model, tr, "peer"), va)
            folds.append(float(rank.daily_ic(va, p).mean()))
            accs.append(float(((p >= .5) == va.y_peer).mean()))
        row = {"features": label, "model": model, "meanIC": float(np.mean(folds)), "folds": [round(f, 4) for f in folds],
               "meanAccuracy": float(np.mean(accs))}
        out["ranking"].append(row)
        print("rank", json.dumps(row), flush=True)
rank.FEATURES = rbase
json.dump(out, open(root / "reports" / "tags-study-dev.json", "w"), indent=2)
