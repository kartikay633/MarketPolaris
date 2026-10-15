"""Cross-sectional daily stock research engine (pulse-rank-v2).

Run: python -m ml.rank {train,infer,score-forward} --data-dir data/pulse

Question studied: after a completed NSE session, which stocks are more likely to
beat their peers (or NIFTY 50, or zero) from the next open over 5/20 sessions?
The protocol below is fixed in code before results are inspected:

* Universe/calendar: cached Upstox V3 daily candles; NIFTY 50 sessions define dates.
* Features use bars at or before the signal date only (tests assert this).
* Targets: peer (beat same-date universe median), benchmark (beat NIFTY 50 over
  the same open-to-close window), absolute (positive return).
* Earliest 80% of label-eligible dates are development; final 20% is a holdout
  evaluated once per target. Four expanding, purged walk-forward folds inside
  development select one candidate per target by mean validation rank IC.
  (Amended before any holdout evaluation: uncalibrated log loss penalised
  over-confident models that rank better, while calibration is a later step.)
* Sigmoid calibration is fitted on concatenated development out-of-fold
  predictions only.
* Primary holdout protocol: refit every 63 sessions on rows whose labels matured
  before the refit date (what production does). Secondary: one frozen model.
* Production predictions continue that refit protocol and are appended to a
  write-once forward ledger, the only genuinely untouched test.

No synthetic prices, LLM output or news text enter this model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ml.pulse import atomic_json, load_candles, utcnow

VERSION = "pulse-rank-v2"
SEED = 271828
HORIZONS = (5, 20)
CALENDAR = "NIFTY_50"
MIN_STOCKS_PER_DATE = 50
REFIT_EVERY = 63
TOP_N = 20
COST_BPS = 20

# Overnight gaps above 25% found by scanning the cached candles. Each coincides
# with a scheme of arrangement/demerger or an apparent provider adjustment
# artifact, not an economic return. Ex-dates of such schemes are announced in
# advance, so excluding label windows that contain them uses no hindsight.
# Feature windows within 252 sessions after them are also excluded.
CORPORATE_EVENTS = [("ADANIENT", "2018-09-06"), ("TATACHEM", "2020-03-04"), ("NMDC", "2022-10-27"),
                    ("SIEMENS", "2025-04-07"), ("VEDL", "2026-04-30")]

STOCK_FEATURES = ["ret_5", "ret_20", "ret_60", "ret_120", "mom_12_1", "vol_20", "vol_60",
                  "downside_vol_60", "idio_vol_60", "beta_120", "max_ret_20", "range_20",
                  "overnight_1", "intraday_1", "dist_high_252", "dist_low_252", "dist_sma_20",
                  "dist_sma_50", "dist_sma_200", "rsi_14", "log_turnover_20", "amihud_20",
                  "volume_trend_5_60", "rel_sector_20", "rel_sector_60", "sector_mom_60"]
MARKET_FEATURES = ["mkt_ret_5", "mkt_ret_20", "mkt_ret_60", "mkt_vol_20", "mkt_trend_200",
                   "breadth_50", "dispersion_20", "midcap_spread_60"]
FEATURES = [f"cs_{f}" for f in STOCK_FEATURES] + MARKET_FEATURES
TARGETS = {"peer": "Next-open to horizon-close return above the same-date universe median",
           "benchmark": "Next-open to horizon-close return above NIFTY 50 over the same window",
           "absolute": "Next-open to horizon-close return above zero"}
PRIMARY_TARGET = "peer"
# Single-factor baselines with signs fixed in advance from published equity
# anomaly research (momentum, short-term reversal, low volatility, 52-week high).
FACTORS = {"momentum_12_1": ("cs_mom_12_1", 1), "reversal_5": ("cs_ret_5", -1),
           "low_volatility": ("cs_vol_60", -1), "near_52w_high": ("cs_dist_high_252", 1)}
CANDIDATES = list(FACTORS) + ["logistic", "gbm", "ensemble"]
LABELS = {"ret_5": "5-session return", "ret_20": "20-session return", "ret_60": "60-session return",
          "ret_120": "120-session return", "mom_12_1": "12-month momentum (skip last month)",
          "vol_20": "20-session volatility", "vol_60": "60-session volatility",
          "downside_vol_60": "Downside volatility", "idio_vol_60": "Stock-specific volatility",
          "beta_120": "Beta to NIFTY 50", "max_ret_20": "Largest daily gain (20 sessions)",
          "range_20": "Average daily range", "overnight_1": "Latest overnight gap",
          "intraday_1": "Latest open-to-close move", "dist_high_252": "Distance from 52-week high",
          "dist_low_252": "Distance from 52-week low", "dist_sma_20": "Distance from 20-day average",
          "dist_sma_50": "Distance from 50-day average", "dist_sma_200": "Distance from 200-day average",
          "rsi_14": "14-session RSI", "log_turnover_20": "Traded value (liquidity)",
          "amihud_20": "Price impact (illiquidity)", "volume_trend_5_60": "Recent volume vs normal",
          "rel_sector_20": "20-session return vs sector peers", "rel_sector_60": "60-session return vs sector peers",
          "sector_mom_60": "Sector 60-session momentum vs universe"}
LIMITATIONS = [
    "Experimental research. Historical evaluation does not establish future profitability.",
    "The universe is today's liquid large/mid caps; stocks that were delisted or fell out of favour are absent, so survivorship bias flatters long-only and momentum results.",
    "Upstox prices appear split/bonus adjusted but exclude dividends; five demerger-like discontinuities are excluded by an explicit list. Other corporate actions are not independently verified.",
    "Execution at the next open is assumed; spreads, circuits, liquidity and market impact beyond the stated round-trip cost are not modelled.",
    "Rows on the same date and overlapping horizons are dependent; uncertainty uses date-block bootstrap and non-overlapping subsamples.",
    "The final holdout period overlaps dates whose absolute-direction results were already published by pulse-daily-v1 on a smaller BSE universe; the forward ledger is the untouched test.",
    "No historical news enters the model: no verified point-in-time archive is available. Gemini output is never a model feature.",
]


def experiment_identity(data_hash):
    source = Path(__file__).read_bytes() + Path(__file__).with_name("pulse.py").read_bytes()
    protocol = {"seed": SEED, "horizons": HORIZONS, "features": FEATURES, "candidates": CANDIDATES,
                "targets": list(TARGETS), "events": CORPORATE_EVENTS, "refit": REFIT_EVERY, "version": VERSION}
    digest = hashlib.sha256(json.dumps({"data": data_hash, "source": hashlib.sha256(source).hexdigest(),
                                        "protocol": protocol}, sort_keys=True).encode()).hexdigest()
    return digest


# ---------------------------------------------------------------- features

def _roll(frame, n):
    """Rolling window tolerating ~10% missing sessions instead of forward filling."""
    return frame.rolling(n, min_periods=max(2, int(n * .9)))


def build_panel(frames, meta):
    """Return the long stock-date table with causal features and forward labels."""
    if CALENDAR not in frames:
        raise ValueError("NIFTY_50 history is required to define the trading calendar")
    cal = frames[CALENDAR].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    if len(stocks) < MIN_STOCKS_PER_DATE:
        raise ValueError(f"At least {MIN_STOCKS_PER_DATE} stocks are required for cross-sectional research")
    wide = {f: pd.DataFrame({s: frames[s][f].reindex(cal) for s in stocks}) for f in ["open", "high", "low", "close", "volume"]}
    O, H, L, C, V = (wide[f] for f in ["open", "high", "low", "close", "volume"])
    r1 = C.pct_change(fill_method=None)
    m = frames[CALENDAR].close.reindex(cal)
    m_open = frames[CALENDAR].open.reindex(cal)
    mr = m.pct_change(fill_method=None)

    events = pd.DataFrame(False, index=cal, columns=stocks)
    for symbol, date in CORPORATE_EVENTS:
        if symbol in events and pd.Timestamp(date) in events.index:
            events.loc[pd.Timestamp(date), symbol] = True
    recent_event = events.astype(int).rolling(253, min_periods=1).max().astype(bool)
    history = C.notna().astype(int).rolling(253, min_periods=1).sum()
    eligible = (history >= 240) & C.notna() & (V > 0) & ~recent_event

    f = {}
    for n in (5, 20, 60, 120):
        f[f"ret_{n}"] = C / C.shift(n) - 1
    f["mom_12_1"] = C.shift(21) / C.shift(252) - 1
    f["vol_20"], f["vol_60"] = _roll(r1, 20).std(), _roll(r1, 60).std()
    f["downside_vol_60"] = np.sqrt(_roll(r1.clip(upper=0) ** 2, 60).mean())
    mean_x, mean_m = _roll(r1, 120).mean(), mr.rolling(120, min_periods=108).mean()
    cov = _roll(r1.mul(mr, axis=0), 120).mean() - mean_x.mul(mean_m, axis=0)
    f["beta_120"] = cov.div(mr.rolling(120, min_periods=108).var(ddof=0), axis=0)
    f["idio_vol_60"] = _roll(r1 - f["beta_120"].mul(mr, axis=0), 60).std()
    f["max_ret_20"] = _roll(r1, 20).max()
    f["range_20"] = _roll((H - L) / C, 20).mean()
    f["overnight_1"] = O / C.shift(1) - 1
    f["intraday_1"] = C / O - 1
    f["dist_high_252"] = C / _roll(H, 252).max() - 1
    f["dist_low_252"] = C / _roll(L, 252).min() - 1
    for n in (20, 50, 200):
        f[f"dist_sma_{n}"] = C / _roll(C, n).mean() - 1
    delta = C.diff()
    gain, loss = _roll(delta.clip(lower=0), 14).mean(), _roll(-delta.clip(upper=0), 14).mean()
    f["rsi_14"] = gain / (gain + loss)
    turnover = (C * V).where(V > 0)
    f["log_turnover_20"] = np.log(_roll(turnover, 20).mean())
    f["amihud_20"] = np.log(_roll(r1.abs() / turnover, 20).mean() * 1e9 + 1e-9)
    f["volume_trend_5_60"] = np.log(_roll(V, 5).mean() / _roll(V, 60).mean())

    sectors = pd.Series({s: meta[s].get("sector") or "OTHER" for s in stocks})
    for n in (20, 60):
        x = f[f"ret_{n}"].where(eligible)
        rel = pd.DataFrame(np.nan, index=cal, columns=stocks)
        sector_mean = pd.DataFrame(np.nan, index=cal, columns=stocks)
        for cols in sectors.groupby(sectors).groups.values():
            sub = x[list(cols)]
            total, count = sub.sum(axis=1, min_count=1), sub.notna().sum(axis=1)
            # Leave-one-out peer mean: a stock is not compared with itself.
            with np.errstate(divide="ignore", invalid="ignore"):
                peers = (total.to_numpy()[:, None] - sub.to_numpy()) / (count.to_numpy()[:, None] - 1)
            peers[(count.to_numpy() < 3)] = np.nan
            rel[list(cols)] = sub.to_numpy() - peers
            sector_mean[list(cols)] = np.repeat((total / count).to_numpy()[:, None], len(cols), axis=1)
        f[f"rel_sector_{n}"] = rel
        if n == 60:
            f["sector_mom_60"] = sector_mean.sub(x.mean(axis=1), axis=0)

    market = {"mkt_ret_5": m / m.shift(5) - 1, "mkt_ret_20": m / m.shift(20) - 1, "mkt_ret_60": m / m.shift(60) - 1,
              "mkt_vol_20": mr.rolling(20).std(), "mkt_trend_200": m / m.rolling(200).mean() - 1,
              "breadth_50": (f["dist_sma_50"] > 0).astype(float).where(eligible & f["dist_sma_50"].notna()).mean(axis=1),
              "dispersion_20": f["ret_20"].where(eligible).std(axis=1)}
    if "NIFTY_MIDCAP_100" in frames:
        mid = frames["NIFTY_MIDCAP_100"].close.reindex(cal)
        market["midcap_spread_60"] = (mid / mid.shift(60) - 1) - market["mkt_ret_60"]
    else:
        market["midcap_spread_60"] = pd.Series(np.nan, index=cal)

    f = {k: v.replace([np.inf, -np.inf], np.nan) for k, v in f.items()}
    eligible &= eligible.sum(axis=1).ge(MIN_STOCKS_PER_DATE).to_numpy()[:, None]
    ri, ci = np.nonzero(eligible.to_numpy())
    long = pd.DataFrame({"date": cal[ri], "symbol": np.array(stocks)[ci], "sector": sectors.to_numpy()[ci]})
    for name in STOCK_FEATURES:
        ranked = f[name].where(eligible).rank(axis=1, pct=True) - .5
        long[f"cs_{name}"] = ranked.to_numpy()[ri, ci]
        long[f"raw_{name}"] = f[name].to_numpy()[ri, ci]
    for name in MARKET_FEATURES:
        long[name] = market[name].replace([np.inf, -np.inf], np.nan).to_numpy()[ri]

    present = C.notna()
    dates = pd.Series(cal, index=cal)
    for h in HORIZONS:
        path_ok = pd.concat([present.shift(-k, fill_value=False) for k in range(1, h + 1)]).groupby(level=0).all()
        event_in = pd.concat([events.shift(-k, fill_value=False) for k in range(1, h + 1)]).groupby(level=0).any()
        fwd = (C.shift(-h) / O.shift(-1) - 1).where(path_ok.reindex(cal) & ~event_in.reindex(cal))
        long[f"fwd_{h}"] = fwd.to_numpy()[ri, ci]
        long[f"bench_{h}"] = (m.shift(-h) / m_open.shift(-1) - 1).to_numpy()[ri]
        long[f"labelEnd_{h}"] = dates.shift(-h).to_numpy()[ri]
    return long


def horizon_frame(long, h):
    d = long.loc[long[f"fwd_{h}"].notna() & long[f"bench_{h}"].notna()].copy()
    d["fwd"], d["labelEnd"] = d[f"fwd_{h}"], pd.to_datetime(d[f"labelEnd_{h}"])
    counts = d.groupby("date").fwd.transform("size")
    d = d.loc[counts >= MIN_STOCKS_PER_DATE].copy()
    d["excess"] = d.fwd - d.groupby("date").fwd.transform("median")
    d["y_peer"] = (d.excess > 0).astype(int)
    d["y_benchmark"] = (d.fwd - d[f"bench_{h}"] > 0).astype(int)
    d["y_absolute"] = (d.fwd > 0).astype(int)
    return d.sort_values(["date", "symbol"]).reset_index(drop=True)


# ---------------------------------------------------------------- models

def fit(name, train, target):
    y = train[f"y_{target}"].to_numpy()
    if name in FACTORS:
        column, sign = FACTORS[name]
        model = LogisticRegression(C=1., max_iter=500)
        model.fit((sign * train[column]).fillna(0).to_frame(), y)
        return {"kind": "factor", "column": column, "sign": sign, "model": model}
    models = {}
    if name in ("logistic", "ensemble"):
        models["logistic"] = make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True), StandardScaler(),
                                           LogisticRegression(C=.05, max_iter=1000)).fit(train[FEATURES], y)
    if name in ("gbm", "ensemble"):
        models["gbm"] = HistGradientBoostingClassifier(max_iter=300, learning_rate=.03, max_leaf_nodes=15,
                                                       min_samples_leaf=1000, l2_regularization=1., max_features=.5,
                                                       early_stopping=False, random_state=SEED).fit(train[FEATURES], y)
    return {"kind": "model", "models": models}


def predict(fitted, frame):
    if fitted["kind"] == "factor":
        return fitted["model"].predict_proba((fitted["sign"] * frame[fitted["column"]]).fillna(0).to_frame())[:, 1]
    return np.mean([m.predict_proba(frame[FEATURES])[:, 1] for m in fitted["models"].values()], axis=0)


def logit(p):
    p = np.clip(np.asarray(p), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p)).reshape(-1, 1)


def calibrate(calibrator, p):
    return calibrator.predict_proba(logit(p))[:, 1] if calibrator is not None else np.asarray(p)


# ---------------------------------------------------------------- metrics

def classification(y, p):
    y, p = np.asarray(y), np.clip(np.asarray(p), 1e-6, 1 - 1e-6)
    return {"accuracy": float(((p >= .5) == y).mean()), "auc": float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None,
            "logLoss": float(log_loss(y, p, labels=[0, 1])), "brier": float(brier_score_loss(y, p)),
            "samples": int(len(y)), "positiveRate": float(y.mean())}


def block_bootstrap(values, block, statistic, repetitions=500):
    """Circular date-block bootstrap; values is a 2-D array with one row per date."""
    n = len(values)
    if n < 10:
        return None
    rng = np.random.default_rng(SEED)
    block = min(block, n)
    stats = []
    for _ in range(repetitions):
        ids = np.concatenate([np.arange(s, s + block) % n for s in rng.integers(0, n, math.ceil(n / block))])[:n]
        stats.append(statistic(values[ids]))
    lo, hi = np.quantile(stats, [.025, .975])
    return {"lower": float(lo), "upper": float(hi), "confidence": .95, "method": "circular date-block bootstrap", "blockSessions": block}


def daily_ic(d, score):
    frame = pd.DataFrame({"date": d.date.to_numpy(), "s": np.asarray(score), "r": d.fwd.to_numpy()})
    frame["s"], frame["r"] = frame.groupby("date").s.rank(), frame.groupby("date").r.rank()
    return frame.groupby("date")[["s", "r"]].corr().xs("s", level=1)["r"].dropna()


def ic_summary(ic, h):
    non_overlap = ic.iloc[::h]
    t = float(non_overlap.mean() / (non_overlap.std() / math.sqrt(len(non_overlap)))) if len(non_overlap) > 2 and non_overlap.std() > 0 else None
    return {"meanIC": float(ic.mean()), "icStd": float(ic.std()), "icHitRate": float((ic > 0).mean()), "dates": int(len(ic)),
            "nonOverlappingDates": int(len(non_overlap)), "nonOverlappingTStat": t,
            "meanICConfidenceInterval": block_bootstrap(ic.to_numpy()[:, None], max(20, h), lambda v: v.mean())}


def accuracy_ci(d, p, target, h):
    daily = pd.DataFrame({"date": d.date.to_numpy(), "c": ((np.asarray(p) >= .5) == d[f"y_{target}"].to_numpy()).astype(float)})
    grouped = daily.groupby("date").c.agg(["sum", "count"]).to_numpy()
    return block_bootstrap(grouped, max(20, h), lambda v: v[:, 0].sum() / v[:, 1].sum())


def quintiles(d, score):
    frame = pd.DataFrame({"date": d.date.to_numpy(), "s": np.asarray(score), "excess": d.excess.to_numpy()})
    frame["q"] = frame.groupby("date").s.transform(lambda s: pd.qcut(s.rank(method="first"), 5, labels=False)) + 1
    by = frame.groupby(["date", "q"]).excess.mean().unstack()
    spread = by[5] - by[1]
    return {"meanExcessByQuintile": {str(int(q)): float(by[q].mean()) for q in by.columns},
            "topMinusBottom": float(spread.mean()), "topMinusBottomHitRate": float((spread > 0).mean())}


def portfolio(d, score, h, cost_bps=COST_BPS, top=TOP_N):
    """Long the top-N scores, rebalance every h sessions; averaged over all h start offsets."""
    frame = pd.DataFrame({"date": d.date.to_numpy(), "symbol": d.symbol.to_numpy(), "s": np.asarray(score),
                          "fwd": d.fwd.to_numpy(), "bench": d[f"bench_{h}"].to_numpy()})
    dates = np.array(sorted(frame.date.unique()))
    groups = dict(tuple(frame.groupby("date")))
    runs = []
    for offset in range(h):
        held, eq, uni, nifty, peak, mdd, wins, rows = set(), 1., 1., 1., 1., 0., 0, 0
        for date in dates[offset::h]:
            g = groups[date]
            picks = g.nlargest(top, "s")
            chosen = set(picks.symbol)
            turnover = 1. if not held else 1 - len(chosen & held) / top
            held = chosen
            net = picks.fwd.mean() - turnover * cost_bps / 10000
            universe = g.fwd.mean()
            eq, uni, nifty = eq * (1 + net), uni * (1 + universe), nifty * (1 + g.bench.iloc[0])
            peak, mdd = max(peak, eq), min(mdd, eq / max(peak, eq) - 1)
            wins += int(net > universe)
            rows += 1
        years = rows * h / 252
        runs.append({"annualReturn": eq ** (1 / years) - 1, "universeAnnualReturn": uni ** (1 / years) - 1,
                     "niftyAnnualReturn": nifty ** (1 / years) - 1, "maxDrawdownAtRebalance": mdd,
                     "periodsBeatingUniverse": wins / rows, "periods": rows})
    out = {k: float(np.mean([r[k] for r in runs])) for k in runs[0] if k != "periods"}
    out["annualExcessVsUniverse"] = out["annualReturn"] - out["universeAnnualReturn"]
    out["annualExcessVsNifty"] = out["annualReturn"] - out["niftyAnnualReturn"]
    out["excessRangeAcrossStartOffsets"] = [float(min(r["annualReturn"] - r["universeAnnualReturn"] for r in runs)),
                                            float(max(r["annualReturn"] - r["universeAnnualReturn"] for r in runs))]
    out.update({"positions": top, "roundTripCostBps": cost_bps, "rebalanceSessions": h, "periodsPerOffset": runs[0]["periods"],
                "description": f"Equal-weight top {top} by model score, next-open entry, rebalanced every {h} sessions, costs on turnover; averaged over {h} start offsets. Universe = equal-weight all eligible stocks, no costs."})
    return out


def selective(y, p):
    """Accuracy when only the most confident predictions are kept (no threshold tuning)."""
    y, p = np.asarray(y), np.asarray(p)
    order = np.argsort(-np.abs(p - .5))
    rows = []
    for share in (.01, .02, .05, .1, .2, .5, 1.):
        k = max(1, int(len(p) * share))
        ids = order[:k]
        rows.append({"coverage": share, "samples": int(k), "accuracy": float(((p[ids] >= .5) == y[ids]).mean()),
                     "minConfidence": float(np.abs(p[ids] - .5).min() + .5)})
    return rows


def reliability(y, p, bins=10):
    frame = pd.DataFrame({"y": np.asarray(y), "p": np.asarray(p)})
    frame["bin"] = pd.qcut(frame.p.rank(method="first"), bins, labels=False)
    agg = frame.groupby("bin").agg(predicted=("p", "mean"), observed=("y", "mean"), samples=("y", "size"))
    return [{k: (int(v) if k == "samples" else float(v)) for k, v in row.items()} for row in agg.to_dict("records")]


def regimes(d, p, target):
    frame = pd.DataFrame({"date": d.date, "year": d.date.dt.year, "trend": np.where(d.mkt_trend_200 >= 0, "NIFTY above 200-day average", "NIFTY below 200-day average"),
                          "correct": ((np.asarray(p) >= .5) == d[f"y_{target}"]).astype(float)})
    ic = daily_ic(d, p)
    frame["ic"] = frame.date.map(ic)
    out = {}
    for key in ("year", "trend"):
        g = frame.groupby(key)
        out[key] = [{"group": str(k), "accuracy": float(v.correct.mean()), "meanIC": float(v.drop_duplicates("date").ic.mean()),
                     "sessions": int(v.date.nunique()), "samples": int(len(v))} for k, v in g]
    return out


def evaluate(d, p, target, h):
    out = classification(d[f"y_{target}"], p)
    out["accuracyConfidenceInterval"] = accuracy_ci(d, p, target, h)
    out["ranking"] = ic_summary(daily_ic(d, p), h)
    out["start"], out["end"], out["sessions"] = d.date.min().date().isoformat(), d.date.max().date().isoformat(), int(d.date.nunique())
    return out


# ---------------------------------------------------------------- protocol

def split_dates(d):
    dates = np.array(sorted(d.date.unique()))
    holdout_start = dates[int(len(dates) * .8)]
    dev = d.loc[(d.date < holdout_start) & (d.labelEnd < holdout_start)]
    dev_dates = np.array(sorted(dev.date.unique()))
    fold_starts = [dev_dates[int(len(dev_dates) * q)] for q in (.4, .55, .7, .85)] + [holdout_start]
    return dev, d.loc[d.date >= holdout_start], fold_starts


def walk_forward(dev, fold_starts, target):
    results, oof = [], {}
    for name in CANDIDATES:
        folds, preds = [], []
        for start, end in zip(fold_starts[:-1], fold_starts[1:]):
            train = dev.loc[dev.labelEnd < start]
            valid = dev.loc[(dev.date >= start) & (dev.labelEnd < end)]
            p = predict(fit(name, train, target), valid)
            metrics = classification(valid[f"y_{target}"], p)
            metrics["meanIC"] = float(daily_ic(valid, p).mean())
            folds.append({"trainEnd": train.date.max().date().isoformat(), "validationStart": valid.date.min().date().isoformat(),
                          "validationEnd": valid.date.max().date().isoformat(), "trainingSamples": int(len(train)), **metrics})
            preds.append(pd.Series(p, index=valid.index))
        weights = [f["samples"] for f in folds]
        results.append({"model": name, "folds": folds,
                        "meanLogLoss": float(np.average([f["logLoss"] for f in folds], weights=weights)),
                        "meanAccuracy": float(np.average([f["accuracy"] for f in folds], weights=weights)),
                        "meanIC": float(np.mean([f["meanIC"] for f in folds]))})
        oof[name] = pd.concat(preds)
        print(f"  {target:<10} {name:<15} logloss={results[-1]['meanLogLoss']:.5f} acc={results[-1]['meanAccuracy']:.4f} ic={results[-1]['meanIC']:+.4f}", flush=True)
    return results, oof


def rolling_holdout(d, holdout, name, target):
    dates = np.array(sorted(holdout.date.unique()))
    parts, refits = [], []
    for i in range(0, len(dates), REFIT_EVERY):
        start = dates[i]
        end = dates[i + REFIT_EVERY] if i + REFIT_EVERY < len(dates) else None
        train = d.loc[d.labelEnd < start]
        block = holdout.loc[(holdout.date >= start) & ((holdout.date < end) if end is not None else True)]
        parts.append(pd.Series(predict(fit(name, train, target), block), index=block.index))
        refits.append({"refitDate": pd.Timestamp(start).date().isoformat(), "trainedThrough": train.date.max().date().isoformat(),
                       "maxLabelDate": train.labelEnd.max().date().isoformat(), "predictedRows": int(len(block))})
    return pd.concat(parts).reindex(holdout.index).to_numpy(), refits


def run_target(d, h, target, artifact_dir):
    dev, holdout, fold_starts = split_dates(d)
    validation, oof = walk_forward(dev, fold_starts, target)
    selected = max(validation, key=lambda r: r["meanIC"])["model"]
    oof_rows = dev.loc[oof[selected].index]
    calibrator = LogisticRegression(C=1.).fit(logit(oof[selected].to_numpy()), oof_rows[f"y_{target}"])
    dev_calibrated = calibrate(calibrator, oof[selected].to_numpy())
    # Holdout: evaluated once with the pre-declared protocols.
    raw_rolling, refits = rolling_holdout(d, holdout, selected, target)
    p_rolling = calibrate(calibrator, raw_rolling)
    frozen = fit(selected, dev, target)
    p_frozen = calibrate(calibrator, predict(frozen, holdout))
    base_rate = float(dev[f"y_{target}"].mean())
    baselines = {"trainingRate": classification(holdout[f"y_{target}"], np.repeat(base_rate, len(holdout)))}
    for factor in FACTORS:
        if factor != selected:
            baselines[factor] = classification(holdout[f"y_{target}"], predict(fit(factor, dev, target), holdout))
            baselines[factor]["meanIC"] = float(daily_ic(holdout, holdout[FACTORS[factor][0]] * FACTORS[factor][1]).mean())
    primary = evaluate(holdout, p_rolling, target, h)
    result = {"target": target, "definition": TARGETS[target], "selectedModel": selected,
              "selectionMetric": "Mean purged walk-forward validation rank IC (development only)",
              "selectionAmendment": "Changed from uncalibrated log loss to rank IC after development results and before any holdout evaluation.",
              "validation": validation,
              "development": {"start": dev.date.min().date().isoformat(), "end": dev.date.max().date().isoformat(),
                              "samples": int(len(dev)), "sessions": int(dev.date.nunique())},
              "calibration": {"method": "sigmoid on development out-of-fold predictions", "samples": int(len(oof_rows)),
                              "reliabilityDevelopment": reliability(oof_rows[f"y_{target}"], dev_calibrated)},
              "selectiveDevelopment": selective(oof_rows[f"y_{target}"].to_numpy(), dev_calibrated),
              "holdout": primary, "holdoutFrozen": evaluate(holdout, p_frozen, target, h), "refits": refits,
              "baselines": baselines, "selectiveHoldout": selective(holdout[f"y_{target}"].to_numpy(), p_rolling),
              "reliabilityHoldout": reliability(holdout[f"y_{target}"], p_rolling),
              "regimes": regimes(holdout, p_rolling, target),
              "quintiles": quintiles(holdout, p_rolling), "portfolio": portfolio(holdout, p_rolling, h),
              "costSensitivity": [{"roundTripCostBps": c, **{k: v for k, v in portfolio(holdout, p_rolling, h, c).items() if k in ("annualReturn", "annualExcessVsUniverse")}} for c in (0, 40)],
              "beatsBaselineLogLoss": primary["logLoss"] < baselines["trainingRate"]["logLoss"],
              "meets90PercentAccuracy": primary["accuracy"] >= .9}
    ci = primary["ranking"]["meanICConfidenceInterval"]
    result["rankingEvidence"] = ("positive" if ci and ci["lower"] > 0 else "negative" if ci and ci["upper"] < 0 else "inconclusive")
    out = holdout[["symbol", "date", "labelEnd", "fwd", "excess", f"y_{target}"]].copy()
    out["probability"] = p_rolling
    out.to_csv(artifact_dir / f"holdout-{target}-{h}.csv", index=False)
    joblib.dump({"calibrator": calibrator, "selected": selected}, artifact_dir / f"calibrator-{target}-{h}.joblib")
    return result


def news_status(root):
    try:
        events = json.loads((root / "news.json").read_text(encoding="utf-8")).get("events", [])
    except FileNotFoundError:
        events = []
    first = min((e.get("firstSeenAt") for e in events if e.get("firstSeenAt")), default=None)
    return {"status": "unavailable", "observedRecords": len(events), "firstObservedAt": first,
            "reason": "News enters an experiment only after it was observed live. Observation began recently, so no labelled historical session can use it; "
                      "retrospective archives with verified original timestamps were not available under the project's access constraints. "
                      "Market-only and news-aware variants will be compared on identical rows once enough mature observations exist."}


def train(data_dir):
    root = Path(data_dir)
    frames, meta, quality, data_hash = load_candles(root)
    version = f"{VERSION}-{experiment_identity(data_hash)[:16]}"
    artifact_dir = root / "models" / version
    existing = artifact_dir / "report.json"
    if existing.exists():
        report = json.loads(existing.read_text(encoding="utf-8"))
        atomic_json(root / "reports" / "latest.json", report)
        infer(root, report)
        return report
    artifact_dir.mkdir(parents=True, exist_ok=True)
    print("Building feature panel...", flush=True)
    long = build_panel(frames, meta)
    horizons = []
    for h in HORIZONS:
        d = horizon_frame(long, h)
        print(f"Horizon {h}: {len(d):,} rows, {d.date.nunique()} sessions, {d.symbol.nunique()} stocks", flush=True)
        targets = {t: run_target(d, h, t, artifact_dir) for t in TARGETS}
        p = targets[PRIMARY_TARGET]
        horizons.append({"horizon": h, "unit": "trading sessions", "primaryTarget": PRIMARY_TARGET, "target": p["definition"],
                         "selectedModel": p["selectedModel"], "holdout": p["holdout"], "baselines": p["baselines"],
                         "meets90PercentAccuracy": p["meets90PercentAccuracy"], "rankingEvidence": p["rankingEvidence"],
                         "targets": targets, "newsAblation": news_status(root)})
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    report = {"generatedAt": utcnow(), "status": "experimental", "modelVersion": version, "pipelineVersion": VERSION,
              "dataHash": data_hash, "seed": SEED, "source": "Upstox Historical Candle Data V3 (NSE daily)",
              "universe": stocks, "sectors": {s: meta[s].get("sector") for s in stocks},
              "benchmarks": sorted(s for s in frames if meta[s].get("benchmark")), "quality": quality,
              "corporateEventsExcluded": [{"symbol": s, "date": d} for s, d in CORPORATE_EVENTS],
              "features": {"stock": STOCK_FEATURES, "market": MARKET_FEATURES, "labels": LABELS,
                           "transform": "Stock features are converted to same-date percentile ranks; market features are raw."},
              "horizons": horizons, "limitations": LIMITATIONS,
              "protocol": {"split": "Earliest 80% of label-eligible dates for development; final 20% holdout evaluated once",
                           "folds": "Four expanding walk-forward folds inside development; training labels end before each validation start",
                           "candidates": CANDIDATES, "selection": "Highest mean validation rank IC per target (amended from log loss before holdout evaluation)",
                           "calibration": "Sigmoid fitted on development out-of-fold predictions",
                           "holdoutPrimary": f"Refit every {REFIT_EVERY} sessions on matured labels only",
                           "holdoutSecondary": "Single model frozen at the end of development",
                           "portfolio": f"Top {TOP_N}, {COST_BPS} bps round-trip cost on turnover"},
              "environment": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "sklearn": sklearn.__version__}}
    atomic_json(existing, report)
    atomic_json(root / "reports" / "latest.json", report)
    infer(root, report)
    return report


# ---------------------------------------------------------------- inference

def drivers(row, coefs):
    contributions = [(name, coefs[f"cs_{name}"] * row[f"cs_{name}"]) for name in STOCK_FEATURES if pd.notna(row[f"cs_{name}"])]
    contributions.sort(key=lambda x: -abs(x[1]))
    return [{"feature": name, "label": LABELS[name], "direction": "supports" if c > 0 else "weighs against",
             "percentile": float(row[f"cs_{name}"] + .5), "value": float(row[f"raw_{name}"]) if pd.notna(row[f"raw_{name}"]) else None}
            for name, c in contributions[:4]]


def infer(data_dir, report=None):
    """Refit the selected configuration on all matured labels (the evaluated protocol) and score the latest session."""
    root = Path(data_dir)
    report = report or json.loads((root / "reports" / "latest.json").read_text(encoding="utf-8"))
    frames, meta, _, data_hash = load_candles(root)
    long = build_panel(frames, meta)
    as_of = long.date.max()
    latest = long.loc[long.date == as_of].reset_index(drop=True)
    artifact_dir = root / "models" / report["modelVersion"]
    by_symbol = {s: {"symbol": s, "sector": meta[s].get("sector"), "asOf": as_of.date().isoformat(), "horizons": {}} for s in latest.symbol}
    flat = []
    for entry in report["horizons"]:
        h = entry["horizon"]
        d = horizon_frame(long, h)
        trained_through = d.date.max().date().isoformat()
        outputs = {}
        for target, result in entry["targets"].items():
            saved = joblib.load(artifact_dir / f"calibrator-{target}-{h}.joblib")
            fitted = fit(saved["selected"], d, target)
            outputs[target] = calibrate(saved["calibrator"], predict(fitted, latest))
        coefs = dict(zip(FEATURES, fit("logistic", d, PRIMARY_TARGET)["models"]["logistic"][-1].coef_[0]))
        rank = pd.Series(outputs[PRIMARY_TARGET]).rank(pct=True).to_numpy()
        evidence = entry["rankingEvidence"]
        for i, row in latest.iterrows():
            tier = "top quintile" if rank[i] > .8 else "bottom quintile" if rank[i] <= .2 else "middle"
            item = {"horizon": h, "probabilityOutperformPeers": float(outputs["peer"][i]),
                    "probabilityBeatNifty": float(outputs["benchmark"][i]), "probabilityUp": float(outputs["absolute"][i]),
                    "peerRankPercentile": float(rank[i]), "tier": tier, "rankingEvidence": evidence,
                    "model": entry["targets"][PRIMARY_TARGET]["selectedModel"], "trainedThrough": trained_through,
                    "drivers": drivers(row, coefs)}
            by_symbol[row.symbol]["horizons"][str(h)] = item
            flat.append({"symbol": row.symbol, "sector": meta[row.symbol].get("sector"), "asOf": as_of.date().isoformat(),
                         "experimental": True, "calibration": "sigmoid (development out-of-fold)",
                         "signal": "up" if tier == "top quintile" else "down" if tier == "bottom quintile" else "uncertain",
                         "calibratedThrough": entry["targets"][PRIMARY_TARGET]["development"]["end"], **item})
    result = {"generatedAt": utcnow(), "modelVersion": report["modelVersion"], "status": "experimental", "dataHash": data_hash,
              "asOf": as_of.date().isoformat(), "target": TARGETS[PRIMARY_TARGET], "predictions": flat,
              "limitations": report["limitations"], "newsUsedInPrediction": False}
    atomic_json(root / "predictions.json", result)
    ledger = root / "forward" / report["modelVersion"] / f"{as_of.date().isoformat()}.json"
    if not ledger.exists():  # write-once: a later run cannot revise an earlier forecast
        atomic_json(ledger, {"recordedAt": utcnow(), "asOf": as_of.date().isoformat(), "dataHash": data_hash,
                             "predictions": [{k: p[k] for k in ("symbol", "horizon", "probabilityOutperformPeers", "probabilityBeatNifty", "probabilityUp", "peerRankPercentile")} for p in flat]})
    return result


def score_forward(data_dir):
    """Score write-once forward forecasts whose horizons have matured. Never used for training or selection."""
    root = Path(data_dir)
    report = json.loads((root / "reports" / "latest.json").read_text(encoding="utf-8"))
    frames, meta, _, _ = load_candles(root)
    long = build_panel(frames, meta)
    summary = {"generatedAt": utcnow(), "modelVersion": report["modelVersion"], "status": "experimental", "horizons": []}
    files = sorted((root / "forward" / report["modelVersion"]).glob("*.json"))
    summary["recordedDays"] = len(files)
    for h in HORIZONS:
        d = horizon_frame(long, h).set_index(["date", "symbol"])
        rows = []
        for file in files:
            entry = json.loads(file.read_text(encoding="utf-8"))
            for p in entry["predictions"]:
                key = (pd.Timestamp(entry["asOf"]), p["symbol"])
                if p["horizon"] == h and key in d.index:
                    rows.append({"date": key[0], "symbol": p["symbol"], "p": p["probabilityOutperformPeers"], "y": int(d.loc[key, "y_peer"]),
                                 "fwd": d.loc[key, "fwd"]})
        if not rows:
            summary["horizons"].append({"horizon": h, "status": "no matured forecasts", "recordedDays": len(files)})
            continue
        frame = pd.DataFrame(rows)
        summary["horizons"].append({"horizon": h, "status": "scored", "maturedSessions": int(frame.date.nunique()),
                                    **classification(frame.y, frame.p), "meanIC": float(daily_ic(frame, frame.p).mean())})
    atomic_json(root / "reports" / "forward.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["train", "infer", "score-forward"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    try:
        result = {"train": train, "infer": infer, "score-forward": score_forward}[args.command](args.data_dir)
        print(json.dumps({"status": result["status"], "modelVersion": result["modelVersion"]}, indent=2))
    except Exception as error:
        atomic_json(Path(args.data_dir) / "reports" / "last-error.json", {"generatedAt": utcnow(), "status": "failed", "error": str(error)})
        raise


if __name__ == "__main__":
    main()
