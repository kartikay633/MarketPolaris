"""Global market, commodity and currency inputs for the v5 shadow research.

Source: data/pulse/global/*.json (scripts/pulse-global.js; Upstox GLOBAL_INDEX and
GLOBAL_INDICATOR daily candles from April 2020).

Point-in-time rule: the provider's global candle dates are not consistent (some
sessions are skipped or dated a day later), so a value counts for NSE signal date t
only if its candle is dated at least two calendar days before t. The previous
overnight US session is already priced into NSE closes at t, so the information
kept is regime and exposure: oil and rupee trends, US volatility, and each stock's
measured sensitivity to them.

Inputs:
* market level (same for every stock): S&P 500, Nasdaq-100, Hang Seng and Nikkei
  20-session returns, S&P realised volatility and drawdown, Brent and USD/INR 5- and
  20-session changes, Brent volatility;
* exposure x move (stock specific): rolling 120-session betas of the stock's daily
  return to Brent, USD/INR and the S&P 500 (all on the same lagged alignment),
  multiplied by the latest 20-session move, plus absolute versions for volatility.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

LAG_DAYS = 2
SERIES = ["SP500", "NASDAQ100", "HANG_SENG", "NIKKEI", "BRENT", "USDINR"]
MARKET = ["g_sp_ret20", "g_sp_ret5", "g_sp_vol20", "g_sp_dd60", "g_ndx_ret20", "g_hsi_ret20", "g_nikkei_ret20",
          "g_brent_ret5", "g_brent_ret20", "g_brent_vol20", "g_usd_ret5", "g_usd_ret20"]
EXPOSURE = ["g_beta_brent", "g_beta_usd", "g_beta_sp", "g_x_brent", "g_x_usd", "g_x_sp", "g_absx_brent", "g_absx_usd", "g_absx_sp"]
FEATURES = MARKET + EXPOSURE


def load_series(root, cal):
    """Close of each global series as known on each NSE session (candle date <= t - 2 days)."""
    out = {}
    folder = Path(root) / "global"
    for name in SERIES:
        path = folder / f"{name}.json"
        if not path.exists():
            out[name] = pd.Series(np.nan, index=cal)
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))["candles"]
        s = pd.Series({pd.Timestamp(r[0][:10]): float(r[4]) for r in rows}).sort_index()
        s = s[~s.index.duplicated(keep="last")]
        lagged = pd.Series(s.to_numpy(), index=s.index + pd.Timedelta(days=LAG_DAYS))
        out[name] = lagged.reindex(lagged.index.union(cal)).ffill(limit=7).reindex(cal)
    return out


def add_global_features(long, root, cal, stocks, closes, pick):
    """Global inputs on a (date, symbol) panel. closes: wide NSE closes (cal x stocks)."""
    g = load_series(root, cal) if root else {n: pd.Series(np.nan, index=cal) for n in SERIES}
    ret = {n: s.pct_change(fill_method=None) for n, s in g.items()}
    market = {
        "g_sp_ret20": g["SP500"] / g["SP500"].shift(20) - 1, "g_sp_ret5": g["SP500"] / g["SP500"].shift(5) - 1,
        "g_sp_vol20": ret["SP500"].rolling(20, min_periods=15).std(), "g_sp_dd60": g["SP500"] / g["SP500"].rolling(60, min_periods=40).max() - 1,
        "g_ndx_ret20": g["NASDAQ100"] / g["NASDAQ100"].shift(20) - 1, "g_hsi_ret20": g["HANG_SENG"] / g["HANG_SENG"].shift(20) - 1,
        "g_nikkei_ret20": g["NIKKEI"] / g["NIKKEI"].shift(20) - 1,
        "g_brent_ret5": g["BRENT"] / g["BRENT"].shift(5) - 1, "g_brent_ret20": g["BRENT"] / g["BRENT"].shift(20) - 1,
        "g_brent_vol20": ret["BRENT"].rolling(20, min_periods=15).std(),
        "g_usd_ret5": g["USDINR"] / g["USDINR"].shift(5) - 1, "g_usd_ret20": g["USDINR"] / g["USDINR"].shift(20) - 1,
    }
    for k, v in market.items():
        long[k] = v.replace([np.inf, -np.inf], np.nan).reindex(long.date).to_numpy()
    r = closes.pct_change(fill_method=None)
    for key, series, move in (("brent", "BRENT", "g_brent_ret20"), ("usd", "USDINR", "g_usd_ret20"), ("sp", "SP500", "g_sp_ret20")):
        x = ret[series]
        cov = r.rolling(120, min_periods=90).cov(x)
        beta = cov.div(x.rolling(120, min_periods=90).var(), axis=0).replace([np.inf, -np.inf], np.nan)
        long[f"g_beta_{key}"] = pick(beta)
        long[f"g_x_{key}"] = long[f"g_beta_{key}"] * long[move]
        long[f"g_absx_{key}"] = long[f"g_x_{key}"].abs()
    return long
