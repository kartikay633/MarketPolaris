"""Crisis replay: should the portfolio rules hold, de-risk or buy the dip when the whole
Indian market panics? Protocol fixed before any result: ml/CRISIS_PROTOCOL.md.

Run: python -m ml.crisis_study {predict,replay,run} --data-dir data/pulse

* `predict` rebuilds point-in-time model outputs: the 20-session peer ranking
  (momentum_12_1 factor) and pulse-risk-v4 (ensemble), refitted every 63 sessions on
  matured labels only, with a walk-forward sigmoid calibrator. Heavy; cached under
  data/pulse/models/crisis-study.
* `replay` ports the paper-bot rules (server/research/bots.js + advisor.js, balanced
  1-month plan) and runs the five policies plus the NIFTY-only arm. Light.

Decisions for session t use candles dated t or earlier (18:00 IST cutoff); orders fill
at the open of t+1; accounts are valued at each close. Research only: no product code
reads this module.
"""
from __future__ import annotations

import argparse
import ctypes
import gc
import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from ml.pulse import atomic_json, load_candles, utcnow

VERSION = "crisis-study-v1"
START_CASH = 200000
COST = .0012                 # per side, as bots.js
REBALANCE_EVERY = 21
MIN_TRADE_SHARE = .02
POSITIONS, CASH_BUFFER, MAX_WEIGHT, PER_SECTOR = 10, .1, .15, 2   # advisor.js balanced profile
MIN_POSITION = 2500
REVIEW_SIGMAS, REVIEW_SESSIONS = 2, 21
ELEVATED, CALM = .65, .35
RANK_MODEL, RISK_MODEL = "momentum_12_1", "ensemble"
REFIT_EVERY, MIN_TRAIN_SESSIONS, MIN_CALIBRATION_SESSIONS = 63, 250, 126

VIX_WINDOW, VIX_MIN, VIX_QUANTILE = 252, 240, .95
DD_WINDOW, DD_LIMIT = 60, .10
MERGE_GAP = 10               # fewer than 10 off sessions between signal days = one episode
EPISODE_TAIL = 63
DERISK_STEPS = ((10, .5), (21, .75))   # off-run < 10: 0.5; < 21: 0.75; else 1.0
CRISIS_CLEAR = 21
BOOT_REPS, BOOT_BLOCK, BOOT_SEED = 2000, 21, 20260419
POLICIES = ["b", "c", "d", "e"]
NAMES = {"a": "NIFTY buy-and-hold", "b": "Current bot rules", "c": "De-risk", "d": "Buy the dip", "e": "Hold through",
         "a'": "NIFTY 100%", "b'": "NIFTY 90% / cash 10%", "c'": "NIFTY de-risk", "d'": "NIFTY buy the dip"}


def free_ram_gb():
    class Status(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                    ("avail", ctypes.c_ulonglong), ("totalPage", ctypes.c_ulonglong), ("availPage", ctypes.c_ulonglong),
                    ("totalVirtual", ctypes.c_ulonglong), ("availVirtual", ctypes.c_ulonglong), ("ext", ctypes.c_ulonglong)]
    try:
        s = Status(); s.length = ctypes.sizeof(Status)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))
        return s.avail / 2 ** 30
    except (AttributeError, OSError):
        return float("inf")


def wait_for_ram(need=2.):
    while (free := free_ram_gb()) < need:
        print(f"  free RAM {free:.1f} GB < {need} GB; waiting", flush=True)
        time.sleep(60)


# ---------------------------------------------------------------- crisis signal

def crisis_signal(nifty, vix):
    """Per-session rules from closes at or before each session only."""
    vix = vix.reindex(nifty.index)
    threshold = vix.shift(1).rolling(VIX_WINDOW, min_periods=VIX_MIN).quantile(VIX_QUANTILE)
    high = nifty.rolling(DD_WINDOW, min_periods=DD_WINDOW).max()
    drawdown = nifty / high - 1
    out = pd.DataFrame({"vix": vix, "vixThreshold": threshold, "vixRule": (vix > threshold) & threshold.notna(),
                        "drawdown60": drawdown, "drawdownRule": drawdown <= -DD_LIMIT})
    out["on"] = out.vixRule | out.drawdownRule
    out["valid"] = threshold.notna() & high.notna()
    return out


def episodes(on, kind=None):
    """Runs of signal days, merging gaps shorter than MERGE_GAP off sessions. Returns [start, end] positions."""
    out = []
    for p in np.flatnonzero(np.asarray(on, dtype=bool)):
        if out and p - out[-1][1] <= MERGE_GAP:
            out[-1][1] = p
        else:
            out.append([p, p])
    if kind is not None:
        kind = np.asarray(kind, dtype=bool)
        return [(s, e, "drawdown" if kind[s:e + 1].any() else "VIX only") for s, e in out]
    return [(s, e, None) for s, e in out]


def off_run(on):
    """Sessions since the signal was last on (0 on a signal day; inf if never on yet)."""
    run, last = np.full(len(on), np.inf), None
    for i, v in enumerate(np.asarray(on, dtype=bool)):
        if v:
            last = i
        if last is not None:
            run[i] = i - last
    return run


def policy_arrays(name, on):
    """Exposure multiplier, plan cash buffer, check-up sells suspended, forced rebalance, per session."""
    run = off_run(on)
    n = len(run)
    exposure, buffer, suspend = np.ones(n), np.full(n, CASH_BUFFER), np.zeros(n, dtype=bool)
    crisis = run < CRISIS_CLEAR
    if name == "c":
        exposure = np.where(run < DERISK_STEPS[0][0], DERISK_STEPS[0][1], np.where(run < DERISK_STEPS[1][0], DERISK_STEPS[1][1], 1.))
        changed = exposure != np.roll(exposure, 1)
    elif name == "d":
        buffer, suspend = np.where(crisis, 0., CASH_BUFFER), crisis
        changed = crisis != np.roll(crisis, 1)
    elif name == "e":
        suspend, changed = crisis, np.zeros(n, dtype=bool)
    else:
        changed = np.zeros(n, dtype=bool)
    changed[0] = False
    return {"exposure": exposure, "buffer": buffer, "suspend": suspend, "force": changed, "crisis": crisis}


# ---------------------------------------------------------------- point-in-time model outputs

def walk_forward(frame, refits, fit_fn, predict_fn):
    """Raw predictions for every row of `frame`; the model for the block starting at refit date R
    is fitted only on rows whose label ended before R (frame.labelEnd < R)."""
    out = pd.Series(np.nan, index=frame.index)
    log = []
    for start, end in zip(refits, list(refits[1:]) + [None]):
        train = frame.loc[frame.labelEnd < start]
        block = frame.loc[(frame.date >= start) & ((frame.date < end) if end is not None else True)]
        if block.empty:
            continue
        out.loc[block.index] = predict_fn(fit_fn(train), block)
        log.append({"refit": start.date().isoformat(), "trainRows": int(len(train)),
                    "maxLabelEnd": train.labelEnd.max().date().isoformat() if len(train) else None})
    return out, log


def walk_calibrate(frame, raw, refits):
    """Sigmoid calibrator refitted at each refit date R on earlier out-of-sample raw predictions
    whose labels ended before R. Blocks without enough matured predictions stay NaN."""
    from ml.rank import logit
    out = pd.Series(np.nan, index=frame.index)
    for start, end in zip(refits, list(refits[1:]) + [None]):
        prior = frame.loc[(frame.date < start) & (frame.labelEnd < start) & raw.notna()]
        block = frame.loc[(frame.date >= start) & ((frame.date < end) if end is not None else True)]
        if block.empty or prior.date.nunique() < MIN_CALIBRATION_SESSIONS:
            continue
        model = LogisticRegression(C=1.).fit(logit(raw.loc[prior.index].to_numpy()), prior.y)
        out.loc[block.index] = model.predict_proba(logit(raw.loc[block.index].to_numpy()))[:, 1]
    return out


def build_predictions(root):
    import ml.rank as rank
    import ml.risk as risk
    wait_for_ram()
    frames, meta, _, data_hash = load_candles(root)
    print(f"Building risk panel (free RAM {free_ram_gb():.1f} GB)...", flush=True)
    long = risk.risk_panel(frames, meta, root)
    print(f"  {len(long):,} rows; free RAM {free_ram_gb():.1f} GB", flush=True)
    # 20-session peer label exactly as ml.rank.horizon_frame, on the few columns it needs.
    peer = rank.horizon_frame(long[["date", "symbol", "fwd_20", "bench_20", "labelEnd_20"]], 20)
    peer = peer[["date", "symbol", "y_peer", "labelEnd"]]
    base = long[["date", "symbol", "sector", "cs_mom_12_1", "raw_vol_20", "normal_vol", "vol_vs_normal"]].copy()
    risk_ok = long.fwd_20.notna() & long.future_vol.notna() & long.normal_vol.notna()   # = ml.risk.risk_frame rows
    base["y"] = np.where(risk_ok, (long.future_vol > long.normal_vol).astype(float), np.nan)
    base["labelEnd"] = pd.to_datetime(long.labelEnd_20).where(risk_ok)
    X = long[risk.FEATURES].astype(np.float32)
    del long
    gc.collect()
    base = base.merge(peer.rename(columns={"labelEnd": "peerLabelEnd"}), on=["date", "symbol"], how="left")
    X.index = base.index

    dates = np.array(sorted(base.date.unique()))
    matured = base.dropna(subset=["labelEnd"])
    first = next(i for i, d in enumerate(dates) if matured.loc[matured.labelEnd < d, "date"].nunique() >= MIN_TRAIN_SESSIONS)
    refits = [pd.Timestamp(d) for d in dates[first::REFIT_EVERY]]
    print(f"  {len(refits)} refits from {refits[0].date()}", flush=True)

    rank_frame = base[["date", "cs_mom_12_1", "y_peer"]].assign(labelEnd=base.peerLabelEnd)
    signs = []

    def fit_rank(train):
        fitted = rank.fit(RANK_MODEL, train.dropna(subset=["y_peer"]).astype({"y_peer": int}), "peer")
        signs.append(float(fitted["model"].coef_[0][0]))
        return fitted
    prob_peer, _ = walk_forward(rank_frame, refits, fit_rank, rank.predict)

    risk_frame = pd.concat([base[["date", "labelEnd", "y", "vol_vs_normal"]], X], axis=1)

    def fit_risk(train):
        wait_for_ram()
        t0 = time.time()
        fitted = risk.fit(RISK_MODEL, train.astype({"y": int}))
        print(f"  risk refit through {train.date.max().date()} ({len(train):,} rows, {time.time() - t0:.0f}s, "
              f"free RAM {free_ram_gb():.1f} GB)", flush=True)
        return fitted
    raw, log = walk_forward(risk_frame, refits, fit_risk, risk.predict)
    p_high = walk_calibrate(risk_frame, raw, refits)
    annual = math.sqrt(252)
    out = pd.DataFrame({"date": base.date, "symbol": base.symbol, "sector": base.sector, "probPeer": prob_peer,
                        "pHighRaw": raw, "pHigh": p_high, "curVol": base.raw_vol_20 * annual, "normVol": base.normal_vol * annual})
    info = {"dataHash": data_hash, "refits": log, "rankCoefficients": signs, "firstRefit": refits[0].date().isoformat(),
            "firstCalibrated": out.loc[out.pHigh.notna(), "date"].min().date().isoformat()}
    return out, info


# ---------------------------------------------------------------- planner port (advisor.js)

class Row:
    __slots__ = ("symbol", "sector", "prob", "tier", "risk_tier", "fvol")

    def __init__(self, symbol, sector, prob, tier, risk_tier, fvol):
        self.symbol, self.sector, self.prob, self.tier, self.risk_tier, self.fvol = symbol, sector, prob, tier, risk_tier, fvol


def forecast_vol(cur, norm, p):
    """advisor.js forecastVol; a missing level counts as 0, as JavaScript's null does."""
    cur = 0. if cur is None or not np.isfinite(cur) else cur
    norm = 0. if norm is None or not np.isfinite(norm) else norm
    return (.5 * cur + .5 * norm) * (.8 + .4 * p)


def day_rows(frame):
    """One session's model outputs as planner rows (symbol order, as the live prediction files)."""
    frame = frame.sort_values("symbol")
    pct = frame.probPeer.rank(pct=True).to_numpy()
    rows = []
    for (symbol, sector, prob, p, cur, norm), q in zip(frame[["symbol", "sector", "probPeer", "pHigh", "curVol", "normVol"]].itertuples(index=False), pct):
        if not np.isfinite(prob) or not np.isfinite(p):
            continue
        tier = "top quintile" if q > .8 else "bottom quintile" if q <= .2 else "middle"
        risk_tier = "elevated" if p >= ELEVATED else "calm" if p <= CALM else "normal"
        rows.append(Row(symbol, sector, float(prob), tier, risk_tier, forecast_vol(cur, norm, p)))
    return rows


def build_plan(budget, rows, closes, cash=CASH_BUFFER):
    """advisor.js buildPlan (balanced, 1-month). Returns [{symbol, quantity, price, riskTier}]."""
    investable = budget * (1 - cash)
    minimum = math.ceil((1 - cash) / MAX_WEIGHT - 1e-9)
    slots = max(minimum, min(POSITIONS, math.floor(investable / MIN_POSITION)))
    picks, sectors = [], {}
    for r in sorted((r for r in rows if r.fvol > 0), key=lambda r: -r.prob):
        if len(picks) >= slots:
            break
        price = closes.get(r.symbol)
        if price is None or price > budget * MAX_WEIGHT:
            continue
        if sectors.get(r.sector, 0) >= PER_SECTOR:
            continue
        sectors[r.sector] = sectors.get(r.sector, 0) + 1
        picks.append(r)
    if not picks:
        return []
    raw = [(1 / r.fvol) * (.5 if r.risk_tier == "elevated" else 1) for r in picks]
    cap = MAX_WEIGHT / (1 - cash)
    total = sum(raw)
    raw = [w / total for w in raw]
    for _ in range(10):
        capped = [min(w, cap) for w in raw]
        spare = 1 - sum(capped)
        free = sum(w for w in capped if w < cap - 1e-9)
        raw = [w + spare * w / free if w < cap - 1e-9 and free > 0 else w for w in capped]
        if spare < 1e-9 or free == 0:
            break
    holdings = []
    for r, w in zip(picks, raw):
        price = closes[r.symbol]
        target = w * (1 - cash)
        qty = math.floor(budget * target / price)
        holdings.append({"symbol": r.symbol, "price": price, "quantity": qty, "amount": round(qty * price, 2),
                         "target": target, "riskTier": r.risk_tier})
    spendable = budget * (1 - cash) - sum(h["amount"] for h in holdings)
    for _ in range(10000):
        ok = [h for h in holdings if h["price"] <= spendable and (h["amount"] + h["price"]) / budget <= MAX_WEIGHT]
        if not ok:
            break
        h = max(ok, key=lambda h: (h["target"] * budget - h["amount"]) / h["price"])
        h["quantity"] += 1
        h["amount"] = round(h["quantity"] * h["price"], 2)
        spendable -= h["price"]
    return [h for h in holdings if h["quantity"] > 0]


def review(budget, cash, positions, by_symbol):
    """advisor.js reviewPortfolio (balanced). positions: [(symbol, quantity, avgPrice, currentPrice)].
    Returns [(action, symbol, quantity)] for sell / trim / add."""
    held_value = sum(q * px for _, q, _, px in positions)
    total = max(budget, held_value)
    spare = max(0., min(cash, total - held_value))
    covered = [s for s, *_ in positions if s in by_symbol and by_symbol[s].fvol > 0]
    inverse = {s: 1 / by_symbol[s].fvol for s in covered}
    inverse_total = sum(inverse.values())
    target_of = lambda s: min(MAX_WEIGHT, inverse[s] / inverse_total * (1 - CASH_BUFFER))
    actions = []
    for symbol, qty, avg, price in positions:
        r = by_symbol.get(symbol)
        if r is None or r.fvol <= 0:
            continue
        weight = qty * price / total if total > 0 else 0
        floor = avg * (1 - min(.35, REVIEW_SIGMAS * r.fvol * math.sqrt(REVIEW_SESSIONS / 252)))
        elevated = r.risk_tier == "elevated"
        if price < floor:
            actions.append(("sell", symbol, qty))
        elif r.tier == "bottom quintile" and elevated:
            actions.append(("sell", symbol, qty))
        elif weight > MAX_WEIGHT * 1.4 or (elevated and weight > MAX_WEIGHT * .6):
            target = MAX_WEIGHT * .5 if elevated else MAX_WEIGHT
            actions.append(("trim", symbol, max(1, math.floor((weight - target) * total / price))))
        elif r.tier == "top quintile" and not elevated and weight < target_of(symbol) * .7 and spare > price:
            actions.append(("add", symbol, max(1, math.floor(min(target_of(symbol) - weight, spare / total) * total / price))))
    return actions


# ---------------------------------------------------------------- bot replay (bots.js)

def replay(sessions, symbols, opens, closes, rows_by_day, start, policy, events=()):
    """Paper bot from session index `start`. opens: [session, symbol] array (NaN = no candle that
    session); closes: forward-filled closes (latest close at or before each session).
    rows_by_day[i]: planner rows built from data up to session i. events: (symbol, ex-date index)."""
    col = {s: j for j, s in enumerate(symbols)}
    exits = {}
    for symbol, at in events:
        exits.setdefault(at - 2, set()).add(symbol)   # decide two sessions ahead: sell at the open before the ex-date
    cash, positions, pending = float(START_CASH), {}, []
    trades, equity, decisions = [], [], []
    last_rebalance = None
    for i in range(start, len(sessions)):
        # Fill yesterday's decisions at today's open: sells first, buys capped by cash.
        for o in sorted(pending, key=lambda o: 0 if o["side"] == "SELL" else 1):
            price = opens[i, col[o["symbol"]]]
            if not np.isfinite(price):
                trades.append({**o, "date": i, "status": "cancelled"})
                continue
            held = positions.get(o["symbol"])
            if o["side"] == "SELL":
                q = min(o["quantity"], held["quantity"] if held else 0)
                if not q:
                    continue
                cash = round(cash + q * price * (1 - COST), 2)
                held["quantity"] -= q
                if held["quantity"] <= 0:
                    del positions[o["symbol"]]
            else:
                q = min(o["quantity"], math.floor(cash / (price * (1 + COST))))
                if q <= 0:
                    trades.append({**o, "date": i, "status": "cancelled"})
                    continue
                outlay = q * price * (1 + COST)
                cash = round(cash - outlay, 2)
                prev = held or {"quantity": 0, "avgPrice": 0.}
                total = prev["quantity"] + q
                positions[o["symbol"]] = {"quantity": total, "avgPrice": round((prev["quantity"] * prev["avgPrice"] + outlay) / total, 4)}
            trades.append({**o, "date": i, "status": "filled", "price": float(price), "filled": int(q)})
        pending = []
        value = cash + sum(p["quantity"] * px if np.isfinite(px := closes[i, col[s]]) else p["quantity"] * p["avgPrice"]
                           for s, p in positions.items())
        invested = value - cash
        equity.append(value)
        if i == len(sessions) - 1:
            decisions.append({"date": i, "orders": 0, "invested": invested / value})
            break
        if i not in rows_by_day:   # no refreshed forecasts: the bot skips the evening
            decisions.append({"date": i, "orders": 0, "invested": invested / value})
            continue
        rows = rows_by_day[i]
        by_symbol = {r.symbol: r for r in rows}
        px_now = {s: float(closes[i, col[s]]) for s in by_symbol if np.isfinite(closes[i, col[s]])}
        budget = math.floor(value * policy["exposure"][i])
        since = math.inf if last_rebalance is None else i - last_rebalance
        orders, rebalance = [], since >= REBALANCE_EVERY or bool(policy["force"][i])
        if rebalance:
            plan = build_plan(budget, rows, px_now, policy["buffer"][i])
            target = {h["symbol"]: h for h in plan}
            for s in positions:
                if s not in target:
                    orders.append({"side": "SELL", "symbol": s, "quantity": positions[s]["quantity"], "reason": "rebalance-exit"})
            for h in plan:
                have = positions.get(h["symbol"], {}).get("quantity", 0)
                diff = h["quantity"] - have
                if abs(diff) * h["price"] < MIN_TRADE_SHARE * value and h["symbol"] in positions:
                    continue
                if diff > 0:
                    orders.append({"side": "BUY", "symbol": h["symbol"], "quantity": diff, "reason": "rebalance-buy"})
                if diff < 0:
                    orders.append({"side": "SELL", "symbol": h["symbol"], "quantity": -diff, "reason": "rebalance-trim"})
            last_rebalance = i
        elif positions:
            held = [(s, p["quantity"], p["avgPrice"], float(closes[i, col[s]]) if np.isfinite(closes[i, col[s]]) else p["avgPrice"])
                    for s, p in positions.items()]
            for action, s, q in review(budget, max(0., cash), held, by_symbol):
                if q and not (policy["suspend"][i] and action in ("sell", "trim")):
                    orders.append({"side": "BUY" if action == "add" else "SELL", "symbol": s, "quantity": q, "reason": f"checkup-{action}"})
        for s in exits.get(i, ()):
            orders = [o for o in orders if o["symbol"] != s]
            if s in positions:
                orders.append({"side": "SELL", "symbol": s, "quantity": positions[s]["quantity"], "reason": "demerger-exit"})
        pending = [{**o, "decided": i} for o in orders]
        decisions.append({"date": i, "orders": len(orders), "rebalance": rebalance, "invested": invested / value})
    return {"equity": np.array(equity), "trades": trades, "decisions": decisions}


def index_replay(open_, close, start, fraction):
    """NIFTY-only account with fractional units: rebalance to fraction[i] of equity every
    REBALANCE_EVERY sessions or when the target changes; fills at the next open."""
    cash, units, order, last = float(START_CASH), 0., 0., None
    equity = []
    for i in range(start, len(close)):
        if order:
            px = open_[i]
            if order > 0:
                order = min(order, cash / (px * (1 + COST)))
                cash -= order * px * (1 + COST)
            else:
                cash += -order * px * (1 - COST)
            units += order
            order = 0.
        value = cash + units * close[i]
        equity.append(value)
        if i == len(close) - 1:
            break
        if last is None or i - last >= REBALANCE_EVERY or fraction[i] != fraction[i - 1]:
            diff = fraction[i] * value - units * close[i]
            if last is None or abs(diff) >= MIN_TRADE_SHARE * value:
                order = diff / close[i]
            last = i
    return np.array(equity)


# ---------------------------------------------------------------- metrics

def metrics(eq, dates):
    eq = np.asarray(eq, dtype=float)
    years = (dates[-1] - dates[0]).days / 365.25
    peak = np.maximum.accumulate(eq)
    dd = eq / peak - 1
    trough = int(dd.argmin())
    top = int(eq[:trough + 1].argmax())
    back = np.flatnonzero(eq[trough:] >= eq[top])
    cagr = (eq[-1] / eq[0]) ** (1 / years) - 1
    return {"totalReturn": float(eq[-1] / eq[0] - 1), "cagr": float(cagr), "maxDrawdown": float(dd[trough]),
            "peak": dates[top].date().isoformat(), "trough": dates[trough].date().isoformat(),
            "recoverySessions": int(trough + back[0] - top) if len(back) else None,
            "returnPerDrawdown": float(cagr / abs(dd[trough])) if dd[trough] < 0 else None}


def window(eq, s, e):
    seg = np.asarray(eq[s:e + 1], dtype=float)
    return {"return": float(seg[-1] / seg[0] - 1), "maxDrawdown": float((seg / np.maximum.accumulate(seg) - 1).min())}


def bootstrap_diff(eq_x, eq_b, reps=BOOT_REPS, block=BOOT_BLOCK, seed=BOOT_SEED):
    """Stationary block bootstrap 90% interval of the annualised mean daily return difference."""
    d = np.diff(eq_x) / eq_x[:-1] - np.diff(eq_b) / eq_b[:-1]
    n, rng = len(d), np.random.default_rng(seed)
    new = rng.random((reps, n)) < 1 / block
    new[:, 0] = True
    starts = rng.integers(n, size=(reps, n))
    t = np.arange(n)
    last = np.maximum.accumulate(np.where(new, t, 0), axis=1)
    means = d[(np.take_along_axis(starts, last, axis=1) + t - last) % n].mean(axis=1)
    return {"annualisedDiff": float(d.mean() * 252), "low90": float(np.quantile(means, .05) * 252),
            "high90": float(np.quantile(means, .95) * 252)}


# ---------------------------------------------------------------- study

def load_inputs(root):
    frames, meta, _, data_hash = load_candles(root)
    sessions = frames["NIFTY_50"].index
    stocks = sorted(s for s in frames if not meta[s].get("benchmark"))
    opens = np.column_stack([frames[s].open.reindex(sessions).to_numpy() for s in stocks])
    closes = np.column_stack([frames[s].close.reindex(sessions).ffill().to_numpy() for s in stocks])
    nifty, vix = frames["NIFTY_50"], frames["INDIA_VIX"].close
    return sessions, stocks, opens, closes, nifty, vix, data_hash


def predictions_path(root, data_hash):
    return Path(root) / "models" / "crisis-study" / f"predictions-{data_hash[:16]}.pkl"


def run_replay(root):
    from ml.rank import CORPORATE_EVENTS
    root = Path(root)
    sessions, stocks, opens, closes, nifty, vix, data_hash = load_inputs(root)
    path = predictions_path(root, data_hash)
    if not path.exists():
        raise SystemExit(f"Missing {path}; run `predict` first")
    preds, info = pd.read_pickle(path)
    pos = {d: i for i, d in enumerate(sessions)}
    signal = crisis_signal(nifty.close, vix)
    start_date = pd.Timestamp(info["firstCalibrated"])
    start = pos[start_date]
    preds = preds.loc[preds.date >= start_date]
    rows_by_day = {pos[d]: day_rows(g) for d, g in preds.groupby("date")}
    events = [(s, pos[pd.Timestamp(d)]) for s, d in CORPORATE_EVENTS if pd.Timestamp(d) in pos]
    dates = sessions[start:]

    triggers = {"primary": signal.on.to_numpy(), "drawdownOnly": signal.drawdownRule.to_numpy(), "vixOnly": signal.vixRule.to_numpy()}
    runs = {}
    for trig, on in triggers.items():
        for name in POLICIES if trig == "primary" else ["c", "d", "e"]:
            t0 = time.time()
            runs[(trig, name)] = replay(sessions, stocks, opens, closes, rows_by_day, start, policy_arrays(name, on), events)
            print(f"  {trig:<12} ({name}) {NAMES[name]:<20} final {runs[(trig, name)]['equity'][-1]:,.0f} ({time.time() - t0:.0f}s)", flush=True)
    # (a) NIFTY buy-and-hold over the same window.
    o, c = nifty.open.to_numpy(), nifty.close.to_numpy()
    units = START_CASH / (o[start + 1] * (1 + COST))
    eq_a = np.concatenate([[START_CASH], units * c[start + 1:]])
    curves = {"a": eq_a, **{n: runs[("primary", n)]["equity"] for n in POLICIES}}

    on = triggers["primary"]
    in_crisis = off_run(on) < CRISIS_CLEAR
    eps = [e for e in episodes(on, triggers["drawdownOnly"]) if e[0] >= start]
    episode_rows = []
    for s, e, kind in eps:
        w_end = min(e + EPISODE_TAIL, len(sessions) - 1)
        row = {"start": sessions[s].date().isoformat(), "end": sessions[e].date().isoformat(), "windowEnd": sessions[w_end].date().isoformat(),
               "kind": kind, "signalDays": int(on[s:e + 1].sum()), "niftyMaxDrawdown60": float(signal.drawdown60.iloc[s:e + 1].min()),
               "vixPeak": float(signal.vix.iloc[s:e + 1].max())}
        for n, eq in curves.items():
            row[n] = window(eq, s - start, w_end - start)
        episode_rows.append(row)

    # Context, not a policy: equal-weight buy-and-hold of today's universe shows the survivorship lift.
    first = opens[start + 1]
    alive = np.isfinite(first)
    ew = np.concatenate([[START_CASH], START_CASH * (closes[start + 1:, alive] / (first[alive] * (1 + COST))).mean(axis=1)])
    survivorship = {**metrics(ew, dates), "stocks": int(alive.sum())}
    summary = {n: metrics(eq, dates) for n, eq in curves.items()}
    for n in curves:
        summary[n]["cagrVsNifty"] = summary[n]["cagr"] - summary["a"]["cagr"]
        summary[n]["maxDrawdownVsNifty"] = summary[n]["maxDrawdown"] - summary["a"]["maxDrawdown"]
        if n in POLICIES:
            summary[n]["averageInvested"] = float(np.mean([d["invested"] for d in runs[("primary", n)]["decisions"]]))
            filled = [t for t in runs[("primary", n)]["trades"] if t["status"] == "filled"]
            summary[n]["fills"] = len(filled)
            summary[n]["crisisCheckupSells"] = sum(1 for t in filled if t["reason"] in ("checkup-sell", "checkup-trim")
                                                   and in_crisis[t["decided"]])
    boot = {n: bootstrap_diff(curves[n], curves["b"]) for n in ["c", "d", "e"]}
    boot["b_vs_a"] = bootstrap_diff(curves["b"], curves["a"])

    # Index-level arm from the first session with a valid signal.
    i0 = int(np.flatnonzero(signal.valid.to_numpy())[0])
    run = off_run(on)
    crisis = run < CRISIS_CLEAR
    expo = np.where(run < DERISK_STEPS[0][0], DERISK_STEPS[0][1], np.where(run < DERISK_STEPS[1][0], DERISK_STEPS[1][1], 1.))
    fractions = {"a'": np.ones(len(c)), "b'": np.full(len(c), 1 - CASH_BUFFER), "c'": (1 - CASH_BUFFER) * expo,
                 "d'": np.where(crisis, 1., 1 - CASH_BUFFER)}
    idx_curves = {n: index_replay(o, c, i0, f) for n, f in fractions.items()}
    idx_dates = sessions[i0:]
    idx_summary = {n: metrics(eq, idx_dates) for n, eq in idx_curves.items()}
    idx_eps = []
    for s, e, kind in episodes(on, triggers["drawdownOnly"]):
        if s < i0:
            continue
        w_end = min(e + EPISODE_TAIL, len(sessions) - 1)
        idx_eps.append({"start": sessions[s].date().isoformat(), "end": sessions[e].date().isoformat(), "kind": kind,
                        **{n: window(eq, s - i0, w_end - i0) for n, eq in idx_curves.items()}})

    # Pre-registered gates.
    n_eps = len(episode_rows)
    need = math.ceil(2 * n_eps / 3)
    verdict = {}
    for n in ["c", "d", "e"]:
        wins = sum(r[n]["return"] > r["b"]["return"] for r in episode_rows)
        g = {"G1": summary[n]["returnPerDrawdown"] > summary["b"]["returnPerDrawdown"],
             "G2": summary[n]["cagr"] >= summary["b"]["cagr"] - .01,
             "G3": wins >= need, "episodeWins": f"{wins}/{n_eps}"}
        if n in ("c", "d"):
            g["G4"] = idx_summary[n + "'"]["returnPerDrawdown"] > idx_summary["b'"]["returnPerDrawdown"]
        g["passes"] = all(v for k, v in g.items() if k.startswith("G"))
        verdict[n] = g
    passing = [n for n in verdict if verdict[n]["passes"]]
    best = max(passing, key=lambda n: summary[n]["returnPerDrawdown"]) if passing else None
    confidence = "low" if n_eps < 8 or best is None or boot[best]["low90"] <= 0 <= boot[best]["high90"] else "moderate"

    sensitivity = {}
    for trig in ("drawdownOnly", "vixOnly"):
        for n in ["c", "d", "e"]:
            sensitivity[f"{trig}:{n}"] = metrics(runs[(trig, n)]["equity"], dates)
    all_eps = [{"start": sessions[s].date().isoformat(), "end": sessions[e].date().isoformat(), "kind": k,
                "signalDays": int(on[s:e + 1].sum())} for s, e, k in episodes(on, triggers["drawdownOnly"])]
    report = {"generatedAt": utcnow(), "version": VERSION, "protocol": "ml/CRISIS_PROTOCOL.md", "dataHash": data_hash,
              "planner": {"start": dates[0].date().isoformat(), "end": dates[-1].date().isoformat(), "sessions": len(dates),
                          "summary": summary, "episodes": episode_rows, "bootstrapVsB": boot,
                          "equalWeightUniverseBuyAndHold": survivorship},
              "index": {"start": idx_dates[0].date().isoformat(), "summary": idx_summary, "episodes": idx_eps},
              "verdict": verdict, "best": best, "confidence": confidence, "sensitivity": sensitivity,
              "allEpisodes": all_eps, "signalDaysShare": float(on[i0:].mean()),
              "models": {k: info[k] for k in ("firstRefit", "firstCalibrated", "rankCoefficients")}, "refits": info["refits"]}
    atomic_json(root / "reports" / "crisis-study.json", report)
    return report


def print_report(r):
    pct = lambda x: "n/a" if x is None else f"{x * 100:+.1f}%"
    p = r["planner"]
    print(f"\nPlanner replay {p['start']} to {p['end']} ({p['sessions']} sessions)")
    print("| Policy | Total | CAGR | Max DD | Recovery | CAGR/|DD| | vs NIFTY CAGR | Avg invested |")
    for n, m in p["summary"].items():
        print(f"| ({n}) {NAMES[n]} | {pct(m['totalReturn'])} | {pct(m['cagr'])} | {pct(m['maxDrawdown'])} | {m['recoverySessions']} | "
              f"{m['returnPerDrawdown']:.2f} | {pct(m['cagrVsNifty'])} | {m.get('averageInvested', 1):.0%} |")
    print("\nEpisodes (window return; b..e vs NIFTY)")
    for e in p["episodes"]:
        print(f"  {e['start']}..{e['end']} {e['kind']:<9} days={e['signalDays']:>3} dd60={e['niftyMaxDrawdown60']:+.1%} vix={e['vixPeak']:.1f} | "
              + " ".join(f"{n}={e[n]['return']:+.1%}/{e[n]['maxDrawdown']:+.1%}" for n in ["a", "b", "c", "d", "e"]))
    print("\nBootstrap vs (b):", json.dumps(p["bootstrapVsB"], indent=None))
    print("\nIndex arm from", r["index"]["start"])
    for n, m in r["index"]["summary"].items():
        print(f"  ({n}) {NAMES[n]:<22} CAGR {pct(m['cagr'])} DD {pct(m['maxDrawdown'])} ratio {m['returnPerDrawdown']:.2f} recovery {m['recoverySessions']}")
    print("\nVerdict:", json.dumps(r["verdict"]), "best:", r["best"], "confidence:", r["confidence"])
    print("Sensitivity:", {k: (round(v["cagr"], 4), round(v["maxDrawdown"], 4)) for k, v in r["sensitivity"].items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["predict", "replay", "run"])
    parser.add_argument("--data-dir", default="data/pulse")
    args = parser.parse_args()
    root = Path(args.data_dir)
    if args.command in ("predict", "run"):
        _, _, _, data_hash = load_candles(root)
        path = predictions_path(root, data_hash)
        if not path.exists():
            out, info = build_predictions(root)
            path.parent.mkdir(parents=True, exist_ok=True)
            pd.to_pickle((out, info), path)
            print(f"Saved {path}", flush=True)
    if args.command in ("replay", "run"):
        print_report(run_replay(root))


if __name__ == "__main__":
    main()
