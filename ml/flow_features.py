"""Point-in-time trading-flow inputs from NSE delivery and bulk/block-deal data (ml.flow_history).

Delivery figures and deals for session t are published by NSE after t's close, like
the closing price, so they count for signal date t and never earlier. A deal dated on
a day outside the candle calendar counts from the next calendar session. Old tickers
are renamed to the universe's current ones only on days before the NSE effective
date (ml.fo_history.symbol_map), so a reused ticker is never merged.

Inputs per stock and session (fl_ prefix):

* delivery: delivery share of traded quantity (fl_dp), its 5-session mean (fl_dp5),
  today's share minus the median of the previous 20 sessions (fl_dp_vs20), the
  5-session mean minus the median of the 60 sessions before it (fl_dp5_vs60), and
  abnormal delivered quantity: log of the 5-session mean over the previous 60-session
  median (fl_deliv_abn5) and of today's over the previous 20-session median
  (fl_deliv_abn1);
* deals: log(1 + number of bulk and of block deal records) over 20 sessions
  (fl_bulk_n20, fl_block_n20), deal buy minus sell quantity and buy plus sell
  quantity as a share of the stock's 20-session traded quantity (fl_deal_net20,
  fl_deal_gross20), and whether any deal was reported in the last 5 sessions
  (fl_deal_any5);
* fl_has_delivery: 1 when that session's delivery figure exists.

A session with no delivery file stays missing (rolling windows tolerate gaps);
deal inputs are missing for months whose deal file was not collected.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from ml.fo_history import symbol_map

DELIVERY = ["fl_dp", "fl_dp5", "fl_dp_vs20", "fl_dp5_vs60", "fl_deliv_abn5", "fl_deliv_abn1"]
DEALS = ["fl_bulk_n20", "fl_block_n20", "fl_deal_net20", "fl_deal_gross20", "fl_deal_any5"]
STOCK = DELIVERY + DEALS
FEATURES = STOCK + ["fl_has_delivery"]


def rename(symbols, dates, mapping):
    """Old ticker -> current ticker, only for rows dated before the change took effect."""
    out = symbols.copy()
    for old, (new, effective) in mapping.items():
        out[(symbols == old) & (dates < effective)] = new
    return out


def load_delivery(root, cal, stocks):
    """Wide traded and delivered quantity (cal x stocks) from the stored daily files."""
    traded = pd.DataFrame(np.nan, index=cal, columns=stocks)
    delivered = traded.copy()
    folder = Path(root) / "flow-history" / "delivery" if root else None
    if folder is None or not folder.exists():
        return traded, delivered
    mapping, universe, rows = symbol_map(root, set(stocks)), set(stocks), []
    position = {d: i for i, d in enumerate(cal)}
    for path in sorted(folder.glob("*.csv.gz")):
        day = pd.Timestamp(path.name[:10])
        if day not in position:
            continue
        d = pd.read_csv(path, dtype={"symbol": str, "series": str})
        d["symbol"] = rename(d.symbol, day, mapping)
        d = d.loc[d.symbol.isin(universe)]
        d = d.assign(eq=d.series.eq("EQ")).sort_values("eq", kind="stable").drop_duplicates("symbol", keep="last")  # EQ preferred
        rows.append(pd.DataFrame({"i": position[day], "symbol": d.symbol, "traded": d.traded, "delivered": d.delivered}))
    if rows:
        all_rows = pd.concat(rows, ignore_index=True)
        col = pd.Index(stocks).get_indexer(all_rows.symbol)
        t, v = traded.to_numpy(), delivered.to_numpy()
        t[all_rows.i.to_numpy(), col] = all_rows.traded.to_numpy(dtype=float)
        v[all_rows.i.to_numpy(), col] = all_rows.delivered.to_numpy(dtype=float)
        traded, delivered = pd.DataFrame(t, index=cal, columns=stocks), pd.DataFrame(v, index=cal, columns=stocks)
    return traded, delivered


def load_deals(root, cal, stocks):
    """Per-session bulk count, block count, buy and sell quantity (cal x stocks); NaN where no deal file covers the month."""
    shape = pd.DataFrame(np.nan, index=cal, columns=stocks)
    out = {k: shape.copy() for k in ("bulk", "block", "buy", "sell")}
    folder = Path(root) / "flow-history" / "deals" if root else None
    if folder is None or not folder.exists():
        return out
    covered = pd.Series(False, index=cal)
    frames = []
    for path in sorted(folder.glob("*.csv.gz")):
        kind, month = path.name.split("-", 1)
        start = pd.Timestamp(month[:7] + "-01")
        covered |= (cal >= start) & (cal <= start + pd.offsets.MonthEnd(0))
        d = pd.read_csv(path, dtype={"symbol": str, "client": str, "side": str, "date": str})
        if len(d):
            frames.append(d.assign(kind=kind))
    for k in out:
        out[k].loc[covered.to_numpy()] = 0.
    if not frames:
        return out
    d = pd.concat(frames, ignore_index=True)
    dates = pd.to_datetime(d.date)
    d["symbol"] = rename(d.symbol, dates, symbol_map(root, set(stocks)))
    d["i"] = cal.searchsorted(dates, side="left")  # a non-calendar date counts from the next session
    d = d.loc[d.symbol.isin(set(stocks)) & (d.i < len(cal))]
    d = d.loc[covered.to_numpy()[d.i.to_numpy()]]
    col = pd.Index(stocks).get_indexer(d.symbol)
    for key, values in (("bulk", (d.kind == "bulk").astype(float)), ("block", (d.kind == "block").astype(float)),
                        ("buy", d.qty.where(d.side == "BUY", 0.).astype(float)), ("sell", d.qty.where(d.side == "SELL", 0.).astype(float))):
        a = out[key].to_numpy()
        np.add.at(a, (d.i.to_numpy(), col), values.fillna(0).to_numpy())
        out[key] = pd.DataFrame(a, index=cal, columns=stocks)
    return out


def flow_frames(root, cal, stocks):
    """Wide feature frames (cal x stocks); every value uses data dated at or before its row."""
    traded, delivered = load_delivery(root, cal, stocks)
    dp = (delivered / traded.where(traded > 0)).clip(0, 1)
    roll = lambda x, n: x.rolling(n, min_periods=max(2, int(n * .75)))
    log = lambda x: np.log(x.where(x > 0))
    f = {"fl_dp": dp, "fl_dp5": roll(dp, 5).mean()}
    f["fl_dp_vs20"] = dp - roll(dp.shift(1), 20).median()
    f["fl_dp5_vs60"] = f["fl_dp5"] - roll(dp.shift(5), 60).median()
    f["fl_deliv_abn5"] = log(roll(delivered, 5).mean()) - log(roll(delivered.shift(5), 60).median())
    f["fl_deliv_abn1"] = log(delivered) - log(roll(delivered.shift(1), 20).median())
    deals = load_deals(root, cal, stocks)
    total = lambda x, n: x.rolling(n, min_periods=n).sum()
    volume20 = traded.fillna(0).rolling(20, min_periods=20).sum().where(roll(traded, 20).count() >= 15)
    f["fl_bulk_n20"] = np.log1p(total(deals["bulk"], 20))
    f["fl_block_n20"] = np.log1p(total(deals["block"], 20))
    f["fl_deal_net20"] = (total(deals["buy"], 20) - total(deals["sell"], 20)) / volume20.where(volume20 > 0)
    f["fl_deal_gross20"] = (total(deals["buy"], 20) + total(deals["sell"], 20)) / volume20.where(volume20 > 0)
    f["fl_deal_any5"] = (total(deals["bulk"] + deals["block"], 5) > 0).astype(float).where(total(deals["bulk"], 5).notna())
    f["fl_has_delivery"] = dp.notna().astype(float)
    return {k: v.replace([np.inf, -np.inf], np.nan) for k, v in f.items()}


def add_flow_features(long, root, cal, stocks, pick, ranks=False):
    """Flow inputs on a (date, symbol) panel; ranks=True adds cs_ cross-sectional ranks for the ranking model."""
    for k, v in flow_frames(root, cal, stocks).items():
        long[k] = pick(v)
    if ranks:
        for k in STOCK:
            long[f"cs_{k}"] = long.groupby("date")[k].rank(pct=True) - .5
    return long
