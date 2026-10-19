"""Point-in-time rules for global inputs. Synthetic fixtures only."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml.global_features import FEATURES, LAG_DAYS, SERIES, add_global_features, load_series

CAL = pd.bdate_range("2025-01-01", periods=260)
STOCKS = ["AAA", "BBB"]


def write_series(root, shift=None):
    folder = Path(root) / "global"
    folder.mkdir(parents=True, exist_ok=True)
    days = pd.date_range("2024-12-01", periods=420)
    rng = np.random.default_rng(5)
    for name in SERIES:
        close = 100 * np.exp(rng.normal(0, .01, len(days)).cumsum())
        if shift is not None:  # perturb every candle dated on or after `shift`
            close = np.where(days >= shift, close * 3, close)
        rows = [[f"{d.date()}T00:00:00+05:30", c, c, c, c, 0, 0] for d, c in zip(days, close)]
        (folder / f"{name}.json").write_text(json.dumps({"symbol": name, "candles": rows}), encoding="utf-8")


def panel(root):
    closes = pd.DataFrame(100 * np.exp(np.random.default_rng(9).normal(0, .01, (len(CAL), 2)).cumsum(0)), index=CAL, columns=STOCKS)
    long = pd.DataFrame([(d, s) for d in CAL for s in STOCKS], columns=["date", "symbol"])
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    return add_global_features(long, root, CAL, STOCKS, closes, lambda f: f.stack(future_stack=True).reindex(idx).to_numpy())


class GlobalFeatureTests(unittest.TestCase):
    def test_value_uses_only_candles_two_days_old(self):
        with tempfile.TemporaryDirectory() as root:
            write_series(root)
            s = load_series(root, CAL)["SP500"]
            raw = {pd.Timestamp(r[0][:10]): r[4] for r in json.loads((Path(root) / "global" / "SP500.json").read_text())["candles"]}
            t = CAL[100]
            self.assertAlmostEqual(s[t], raw[t - pd.Timedelta(days=LAG_DAYS)])

    def test_future_and_recent_global_prices_do_not_change_features(self):
        cut = CAL[200]
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            write_series(a)
            write_series(b, shift=cut - pd.Timedelta(days=LAG_DAYS - 1))  # changes candles dated after t - 2 days
            pa, pb = panel(a), panel(b)
            keep = lambda p: p.loc[p.date <= cut, FEATURES].reset_index(drop=True)
            pd.testing.assert_frame_equal(keep(pa), keep(pb))
            self.assertTrue(pa.loc[pa.date == cut, "g_beta_brent"].notna().all())

    def test_missing_global_data_leaves_inputs_missing(self):
        with tempfile.TemporaryDirectory() as root:
            out = panel(root)
            self.assertTrue(out[FEATURES].isna().all().all())


if __name__ == "__main__":
    unittest.main()
