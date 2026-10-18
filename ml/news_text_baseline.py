"""Does disclosure text predict the market reaction? Classic baselines before any LLM fine-tuning.

Run: python -m ml.news_text_baseline --data-dir data/pulse

Uses data/pulse/news-history/reactions.pkl from ml.news_study. Chronological split,
fixed before results: train before 2023-07-01, validation to 2024-06-30, test after.
Targets: big_move (first-session |abnormal move| > 1.5 sigma, a risk target) and
drift5_up (abnormal return from the next open over 5 sessions > 0, tradable).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from scipy.sparse import hstack

from ml.pulse import atomic_json, utcnow

TRAIN_END, VALID_END = pd.Timestamp("2023-07-01"), pd.Timestamp("2024-07-01")


def dataset(root):
    r = pd.read_pickle(Path(root) / "news-history" / "reactions.pkl")
    r = r.dropna(subset=["z0", "drift5"]).copy()
    r["doc"] = r.category + " || " + r.text.str.slice(0, 600)
    r["big_move"] = (r.z0 > 1.5).astype(int)
    r["drift5_up"] = (r.drift5 > 0).astype(int)
    r["split"] = np.where(r.ts < TRAIN_END, "train", np.where(r.ts < VALID_END, "valid", "test"))
    return r


def evaluate(y, p):
    y, p = np.asarray(y), np.asarray(p)
    order = np.argsort(-np.abs(p - .5))
    top = order[: max(1, len(p) // 10)]
    return {"samples": int(len(y)), "positiveRate": float(y.mean()), "auc": float(roc_auc_score(y, p)),
            "accuracy": float(((p >= .5) == y).mean()), "accuracyConfident10pct": float(((p[top] >= .5) == y[top]).mean()),
            "majorityAccuracy": float(max(y.mean(), 1 - y.mean()))}


def run(root):
    r = dataset(root)
    out = {"generatedAt": utcnow(), "split": {"trainEnd": str(TRAIN_END.date()), "validEnd": str(VALID_END.date())},
           "counts": r.split.value_counts().to_dict(), "targets": {}}
    tr, te = r[r.split == "train"], r[r.split == "test"]
    for target in ("big_move", "drift5_up"):
        res = {}
        # 1. Category only
        cats = pd.get_dummies(r.category)
        m = LogisticRegression(max_iter=2000, C=1.).fit(cats.loc[tr.index], tr[target])
        res["categoryOnly"] = evaluate(te[target], m.predict_proba(cats.loc[te.index])[:, 1])
        # 2. TF-IDF words + bigrams on category and text
        vec = TfidfVectorizer(min_df=5, max_features=60000, ngram_range=(1, 2), sublinear_tf=True)
        xtr, xte = vec.fit_transform(tr.doc), vec.transform(te.doc)
        m = LogisticRegression(max_iter=3000, C=.5).fit(xtr, tr[target])
        p = m.predict_proba(xte)[:, 1]
        res["tfidf"] = evaluate(te[target], p)
        # 3. TF-IDF + the stock's pre-event volatility regime (known before the event)
        if target == "big_move":
            res["note"] = "big_move uses sigma-scaled moves, so stock volatility is already normalised out"
        terms = np.array(vec.get_feature_names_out())
        coef = m.coef_[0]
        res["topPositiveTerms"] = terms[np.argsort(-coef)[:25]].tolist()
        res["topNegativeTerms"] = terms[np.argsort(coef)[:25]].tolist()
        out["targets"][target] = res
    atomic_json(Path(root) / "reports" / "news-text-baseline.json", out)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    out = run(args.data_dir)
    for target, res in out["targets"].items():
        print(target, {k: {m: round(v, 4) for m, v in res[k].items() if isinstance(v, float)} for k in ("categoryOnly", "tfidf")})
        print("  +", res["topPositiveTerms"][:15]); print("  -", res["topNegativeTerms"][:15])


if __name__ == "__main__":
    main()
