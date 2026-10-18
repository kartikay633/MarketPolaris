"""Point-in-time stock implied volatility from NSE F&O bhavcopies (ml.fo_history).

Run: python -m ml.option_features study --data-dir data/pulse              (development folds only)
     python -m ml.option_features study --data-dir data/pulse --holdout    (adds the one-time holdout)

At-the-money implied volatility, per stock and session, uses only that session's
end-of-day bhavcopy (published after the close, like the closing price itself):

* Forward F is the same-expiry stock future's close (settlement price if the
  future did not trade). Options are Black-76 priced; r is a constant 6.5%.
* Only options that traded that day count. For each expiry the call and put
  implied volatilities are averaged per strike, then interpolated linearly in
  strike to F between the nearest strikes below and above it (the nearest strike
  alone if it is within 5% of F).
* Expiries less than 7 calendar days away are skipped. Total variance is
  interpolated linearly in time to 28 calendar days (about 20 sessions) when two
  expiries bracket it; otherwise the nearest usable expiry is used as is.
* A missing day is carried forward at most 3 sessions. Stocks outside F&O have
  no value and are imputed by the model pipeline.

Study protocol, fixed before results were inspected: pulse-risk-v3 inputs vs
v3 + implied-volatility inputs, logistic and the logistic/GBM ensemble, on the
four development walk-forward folds of ml.rank.split_dates with sigmoid
calibration on out-of-fold predictions. The holdout is scored once, and only if
the best implied-volatility set improves mean development AUC by at least 0.005
and improves it in at least three of the four folds.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.special import ndtr

from ml.fo_history import read_day, symbol_map
from ml.pulse import atomic_json, utcnow

METHOD = "atm-iv-v1"
RATE = .065
MIN_DAYS, TARGET_DAYS = 7, 28
STRIKE_BAND, NEAREST_ONLY = .10, .05
CARRY = 3
IV_BOUNDS = (.02, 3.)
CORE = ["o_lr_iv", "o_iv_vs_median", "o_iv_minus_rv", "o_has_iv"]
EXTRA = ["o_iv_level", "o_iv_rv_ratio", "o_iv_chg5", "o_iv_term"]


def black76(F, K, T, sigma, call, r=RATE):
    sd = sigma * np.sqrt(T)
    d1 = (np.log(F / K) + .5 * sd ** 2) / sd
    d2 = d1 - sd
    df = np.exp(-r * T)
    return np.where(call, df * (F * ndtr(d1) - K * ndtr(d2)), df * (K * ndtr(-d2) - F * ndtr(-d1)))


def implied_vol(price, F, K, T, call, r=RATE, iterations=60):
    """Vectorised bisection; NaN where the price violates no-arbitrage bounds."""
    price, F, K, T, call = (np.asarray(x, dtype=float) for x in (price, F, K, T, call))
    call = call.astype(bool)
    df = np.exp(-r * T)
    intrinsic = df * np.where(call, np.maximum(F - K, 0), np.maximum(K - F, 0))
    upper = df * np.where(call, F, K)
    ok = (price > intrinsic) & (price < upper) & (T > 0) & (F > 0) & (K > 0)
    lo, hi = np.full(price.shape, IV_BOUNDS[0] / 2), np.full(price.shape, IV_BOUNDS[1] * 2)
    for _ in range(iterations):
        mid = (lo + hi) / 2
        high = black76(F, K, T, mid, call, r) > price
        hi, lo = np.where(high, mid, hi), np.where(high, lo, mid)
    iv = (lo + hi) / 2
    return np.where(ok & (iv > IV_BOUNDS[0]) & (iv < IV_BOUNDS[1]), iv, np.nan)


def expiry_atm(day, date):
    """ATM implied volatility per (symbol, expiry) for one session's contracts."""
    fut = day.loc[day.kind == "FUT"].copy()
    fut["F"] = fut.close.where(fut.volume > 0, fut.settle)
    fut = fut.loc[fut.F > 0, ["symbol", "expiry", "F"]].drop_duplicates(["symbol", "expiry"])
    opt = day.loc[day.kind.isin(["CE", "PE"]) & (day.volume > 0) & (day.close > 0)].merge(fut, on=["symbol", "expiry"])
    opt["days"] = (opt.expiry - date).dt.days
    opt = opt.loc[(opt.days >= 1) & (np.abs(np.log(opt.strike / opt.F)) <= STRIKE_BAND)]
    if opt.empty:
        return pd.DataFrame(columns=["symbol", "expiry", "days", "iv"])
    opt["iv"] = implied_vol(opt.close, opt.F, opt.strike, opt.days / 365, opt.kind == "CE")
    k = opt.dropna(subset=["iv"]).groupby(["symbol", "expiry", "strike"], as_index=False).agg(iv=("iv", "mean"), F=("F", "first"),
                                                                                              days=("days", "first"))
    k = k.sort_values(["symbol", "expiry", "strike"])
    keys = ["symbol", "expiry"]
    below = k.loc[k.strike <= k.F].groupby(keys).last()
    above = k.loc[k.strike >= k.F].groupby(keys).first()
    both = below.join(above, lsuffix="_b", rsuffix="_a", how="outer")
    F = both.F_b.fillna(both.F_a)
    w = ((F - both.strike_b) / (both.strike_a - both.strike_b)).where(both.strike_a > both.strike_b, 0.)
    bracket = both.iv_b * (1 - w) + both.iv_a * w
    dist_b, dist_a = np.abs(np.log(both.strike_b / F)), np.abs(np.log(both.strike_a / F))
    nearest = np.where(dist_b.fillna(np.inf) <= dist_a.fillna(np.inf), both.iv_b, both.iv_a)
    near_ok = np.fmin(dist_b, dist_a) <= NEAREST_ONLY
    iv = bracket.where(bracket.notna(), pd.Series(np.where(near_ok, nearest, np.nan), index=both.index))
    out = pd.DataFrame({"days": both.days_b.fillna(both.days_a), "iv": iv}).reset_index()
    return out.dropna(subset=["iv"])


def constant_maturity(atm):
    """Per symbol: total-variance interpolation to TARGET_DAYS from expiries at least MIN_DAYS away."""
    a = atm.loc[atm.days >= MIN_DAYS].sort_values(["symbol", "days"])
    first = a.groupby("symbol").nth(0).set_index("symbol")
    second = a.groupby("symbol").nth(1).set_index("symbol").reindex(first.index)
    t1, t2 = first.days, second.days
    v1, v2 = first.iv ** 2 * t1, second.iv ** 2 * t2
    w = (TARGET_DAYS - t1) / (t2 - t1)
    interp = np.sqrt((v1 + w * (v2 - v1)) / TARGET_DAYS)
    bracketed = (t1 <= TARGET_DAYS) & (t2 >= TARGET_DAYS)
    iv = interp.where(bracketed & second.iv.notna(), first.iv)
    return pd.DataFrame({"iv": iv, "iv_near": first.iv, "iv_next": second.iv, "days_near": t1})


def atm_iv_table(root, universe):
    """Long (date, symbol) table of 20-session ATM implied volatility, cached per day file."""
    root = Path(root)
    cache = root / "fo-history" / f"{METHOD}.csv.gz"
    done = pd.read_csv(cache, parse_dates=["date"]) if cache.exists() else pd.DataFrame()
    have = set(done.date.dt.date.astype(str)) if len(done) else set()
    mapping = symbol_map(root, set(universe))
    parts = [done] if len(done) else []
    for path in sorted((root / "fo-history" / "days").glob("*.csv.gz")):
        if path.name[:10] in have:
            continue
        date = pd.Timestamp(path.name[:10])
        cm = constant_maturity(expiry_atm(read_day(path, mapping, universe), date)).reset_index()
        cm.insert(0, "date", date)
        parts.append(cm)
    table = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["date", "symbol", "iv"])
    table["date"] = pd.to_datetime(table.date).astype("datetime64[ns]")
    if len(parts) > (1 if len(done) else 0):
        table.sort_values(["date", "symbol"]).to_csv(cache, index=False, date_format="%Y-%m-%d")
    return table.loc[table.symbol.isin(universe)]


def add_option_features(long, root, cal, stocks, pick):
    """Implied-volatility inputs on the ml.risk panel; values at t use the bhavcopy of t only."""
    table = atm_iv_table(root, stocks) if root and (Path(root) / "fo-history" / "days").exists() else pd.DataFrame(columns=["date", "symbol", "iv"])
    wide = lambda col: (table.pivot_table(index="date", columns="symbol", values=col).reindex(index=cal, columns=stocks)
                        if len(table) else pd.DataFrame(np.nan, index=cal, columns=stocks))
    iv = wide("iv").ffill(limit=CARRY)
    term = np.log(wide("iv_next") / wide("iv_near")).ffill(limit=CARRY)
    f = {"iv": iv, "iv_vs_median": np.log(iv / iv.rolling(252, min_periods=120).median()),
         "iv_chg5": np.log(iv / iv.shift(5)), "iv_term": term}
    for k, v in f.items():
        long[f"o_{k}"] = pick(v.replace([np.inf, -np.inf], np.nan))
    daily = long.o_iv / np.sqrt(252)
    long["o_iv_level"] = np.log(long.o_iv)
    long["o_lr_iv"] = np.log(daily / long.normal_vol).replace([np.inf, -np.inf], np.nan)
    long["o_iv_minus_rv"] = long.o_iv - long.raw_vol_20 * np.sqrt(252)
    long["o_iv_rv_ratio"] = np.log(daily / long.raw_vol_20).replace([np.inf, -np.inf], np.nan)
    long["o_has_iv"] = long.o_iv.notna().astype(float)
    return long


def study(data_dir, holdout=False):
    from sklearn.linear_model import LogisticRegression

    import ml.risk as risk
    from ml.pulse import load_candles
    from ml.rank import REFIT_EVERY, calibrate, classification, logit, selective, split_dates

    root = Path(data_dir)
    frames, meta, _, data_hash = load_candles(root)
    cal = frames[risk.CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    long = risk.risk_panel(frames, meta, root)
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    add_option_features(long, root, cal, stocks, lambda frame: frame.stack(future_stack=True).reindex(idx).to_numpy())
    d = risk.risk_frame(long)
    dev, hold, starts = split_dates(d)
    base = list(risk.FEATURES)
    sets = {"v3": base, "v3+iv core": base + CORE, "v3+iv all": base + CORE + EXTRA}
    coverage = d.groupby(d.date.dt.year).o_has_iv.mean().round(3).to_dict()
    print(f"{len(d):,} rows; IV coverage by year {coverage}", flush=True)
    results = []
    for label, features in sets.items():
        risk.FEATURES = features
        for model in ("logistic", "ensemble"):
            folds, preds = [], []
            for start, end in zip(starts[:-1], starts[1:]):
                tr = dev.loc[dev.labelEnd < start]
                va = dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
                p = risk.predict(risk.fit(model, tr), va)
                folds.append({"validationStart": va.date.min().date().isoformat(), "auc": risk.auc(va.y, p), **classification(va.y, p)})
                preds.append(pd.Series(p, index=va.index))
            oof = pd.concat(preds)
            rows = dev.loc[oof.index]
            calibrator = LogisticRegression(C=1.).fit(logit(oof.to_numpy()), rows.y)
            cp = calibrate(calibrator, oof.to_numpy())
            w = [f["samples"] for f in folds]
            results.append({"features": label, "model": model, "meanAUC": float(np.mean([f["auc"] for f in folds])),
                            "foldAUC": [f["auc"] for f in folds],
                            "meanAccuracy": float(np.average([f["accuracy"] for f in folds], weights=w)),
                            "calibratedAccuracy": float(((cp >= .5) == rows.y).mean()),
                            "confidentHalf": selective(rows.y.to_numpy(), cp), "calibrator": calibrator})
            r = results[-1]
            print(f"  {label:<12} {model:<9} auc={r['meanAUC']:.4f} folds={np.round(r['foldAUC'], 4).tolist()} "
                  f"acc={r['meanAccuracy']:.4f} cal.acc={r['calibratedAccuracy']:.4f}", flush=True)
    baseline = max((r for r in results if r["features"] == "v3"), key=lambda r: r["meanAUC"])
    best = max((r for r in results if r["features"] != "v3"), key=lambda r: r["meanAUC"])
    gain = best["meanAUC"] - baseline["meanAUC"]
    folds_better = int(sum(b > a for a, b in zip(baseline["foldAUC"], best["foldAUC"])))
    passes = gain >= .005 and folds_better >= 3
    report = {"generatedAt": utcnow(), "method": METHOD, "dataHash": data_hash, "rows": int(len(d)), "ivCoverageByYear": coverage,
              "development": [{k: v for k, v in r.items() if k != "calibrator"} for r in results],
              "baseline": f"{baseline['features']} / {baseline['model']}", "best": f"{best['features']} / {best['model']}",
              "developmentAUCGain": gain, "foldsImproved": folds_better, "passesGate": passes}
    print(f"best {report['best']} vs {report['baseline']}: gain {gain:+.4f}, {folds_better}/4 folds; gate {'passed' if passes else 'not passed'}", flush=True)
    if holdout and passes:
        report["holdout"] = {}
        for r in (baseline, best):
            risk.FEATURES = sets[r["features"]]
            dates = np.array(sorted(hold.date.unique()))
            parts = []
            for i in range(0, len(dates), REFIT_EVERY):
                start = dates[i]
                end = dates[i + REFIT_EVERY] if i + REFIT_EVERY < len(dates) else None
                block = hold.loc[(hold.date >= start) & ((hold.date < end) if end is not None else True)]
                parts.append(pd.Series(risk.predict(risk.fit(r["model"], d.loc[d.labelEnd < start]), block), index=block.index))
            p = calibrate(r["calibrator"], pd.concat(parts).reindex(hold.index).to_numpy())
            out = risk.evaluate(hold, p)
            out["auc"] = risk.auc(hold.y, p)
            out["selective"] = selective(hold.y.to_numpy(), p)
            out["tiers"] = risk.tiers(hold, p)
            report["holdout"][f"{r['features']} / {r['model']}"] = out
            print(f"  holdout {r['features']} / {r['model']}: acc={out['accuracy']:.4f} auc={out['auc']:.4f}", flush=True)
    elif holdout:
        print("holdout not scored: development gate not passed", flush=True)
    risk.FEATURES = base
    atomic_json(root / "reports" / "iv-study.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["study"])
    parser.add_argument("--data-dir", default="data/pulse")
    parser.add_argument("--holdout", action="store_true")
    args = parser.parse_args()
    study(args.data_dir, args.holdout)


if __name__ == "__main__":
    main()
