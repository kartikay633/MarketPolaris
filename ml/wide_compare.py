"""Score the wide-universe gates of ml/WIDE_PROTOCOL.md (run once, after both wide trainings).

Run: python -m ml.wide_compare --core data/pulse --wide data/pulse-wide

Reads only finished reports and saved holdout predictions; it fits nothing.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import roc_auc_score

from ml.pulse import atomic_json, utcnow

RISK_AUC_FLOOR = 0.779   # v4's holdout AUC 0.789 less 0.01, fixed in the protocol
CORE_TOLERANCE = 0.005
RANK_HORIZON = 20        # the horizon the paper accounts trade


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def risk_holdout(root):
    report = read(Path(root) / "reports" / "risk-latest.json")
    rows = pd.read_csv(Path(root) / "models" / report["modelVersion"] / "holdout-risk.csv")
    return report, rows


def gates(core, wide):
    core_report, core_rows = risk_holdout(core)
    wide_report, wide_rows = risk_holdout(wide)
    shared = core_rows.merge(wide_rows, on=["symbol", "date"], suffixes=("_core", "_wide"))
    shared = shared.loc[shared.y_core == shared.y_wide]
    core_auc = roc_auc_score(shared.y_core, shared.probability_core)
    wide_on_core = roc_auc_score(shared.y_wide, shared.probability_wide)

    rank = read(Path(wide) / "reports" / "latest.json")
    horizon = next(h for h in rank["horizons"] if h["horizon"] == RANK_HORIZON)
    target = horizon["targets"][horizon["primaryTarget"]]
    ic = target["holdout"]["ranking"]
    excess = target["portfolio"]["annualExcessVsUniverse"]

    g1 = wide_report["holdout"]["auc"] >= RISK_AUC_FLOOR
    g2 = wide_on_core >= core_auc - CORE_TOLERANCE
    g3 = ic["meanICConfidenceInterval"]["lower"] > 0 and excess > 0
    return {
        "generatedAt": utcnow(),
        "protocol": "ml/WIDE_PROTOCOL.md",
        "models": {"coreRisk": core_report["modelVersion"], "wideRisk": wide_report["modelVersion"], "wideRank": rank["modelVersion"]},
        "gate1RiskWide": {"holdoutAuc": wide_report["holdout"]["auc"], "accuracy": wide_report["holdout"]["accuracy"],
                          "samples": wide_report["holdout"]["samples"], "floor": RISK_AUC_FLOOR, "passed": bool(g1)},
        "gate2RiskCore": {"sharedStockDates": int(len(shared)), "sharedStocks": int(shared.symbol.nunique()),
                          "v4Auc": float(core_auc), "wideAuc": float(wide_on_core), "tolerance": CORE_TOLERANCE, "passed": bool(g2)},
        "gate3Rank20": {"selectedModel": target.get("selectedModel"), "meanIC": ic["meanIC"], "meanICConfidenceInterval": ic["meanICConfidenceInterval"],
                        "annualExcessVsUniverse": excess, "passed": bool(g3)},
        "outcome": "wide shadow account" if g1 and g2 and g3 else "wide risk tiers only" if g1 and g2 else "not used",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--core", default="data/pulse")
    parser.add_argument("--wide", default="data/pulse-wide")
    args = parser.parse_args()
    result = gates(args.core, args.wide)
    atomic_json(Path(args.wide) / "reports" / "wide-gates.json", result)
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
