"""Synthetic fixtures validate mechanics only; these are not model evidence."""
import unittest

import numpy as np
import pandas as pd

from ml.rank import split_dates
from ml.risk import ELEVATED, CALM, FEATURES, HORIZON, risk_frame, risk_panel, tiers
from ml.test_rank import universe


class RiskLeakageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames, cls.meta = universe(n_days=480)
        cls.panel = risk_panel(cls.frames, cls.meta)

    def test_future_prices_do_not_change_features_or_reference_level(self):
        cut = self.frames["NIFTY_50"].index[400]
        changed = {k: v.copy() for k, v in self.frames.items()}
        for frame in changed.values():
            later = frame.index > cut
            frame.loc[later, ["open", "high", "low", "close"]] *= np.exp(np.random.default_rng(7).normal(0, .2, (later.sum(), 1)))
        after = risk_panel(changed, self.meta)
        cols = ["date", "symbol", "normal_vol", "vol_vs_normal", "vol60_vs_normal"] + FEATURES
        a = self.panel.loc[self.panel.date <= cut, cols].reset_index(drop=True)
        b = after.loc[after.date <= cut, cols].reset_index(drop=True)
        pd.testing.assert_frame_equal(a, b)

    def test_label_is_volatility_of_the_next_twenty_returns(self):
        row = self.panel.dropna(subset=["future_vol"]).iloc[50]
        close = self.frames[row.symbol].close
        i = close.index.get_loc(row.date)
        expected = close.pct_change().iloc[i + 1:i + HORIZON + 1].std()
        self.assertAlmostEqual(row.future_vol, expected)

    def test_reference_level_uses_only_past_volatility(self):
        row = self.panel.dropna(subset=["normal_vol"]).iloc[30]
        close = self.frames[row.symbol].close
        i = close.index.get_loc(row.date)
        vol20 = close.pct_change().rolling(20, min_periods=18).std()
        self.assertAlmostEqual(row.normal_vol, vol20.iloc[max(0, i - 251):i + 1].median())

    def test_purged_split_and_label_definition(self):
        d = risk_frame(self.panel)
        dev, holdout, starts = split_dates(d)
        self.assertLess(dev.labelEnd.max(), holdout.date.min())
        self.assertTrue(((d.future_vol > d.normal_vol).astype(int) == d.y).all())

    def test_tiers_use_fixed_thresholds(self):
        d = pd.DataFrame({"y": [1, 0, 1, 0], "future_vs_normal": [1.5, .8, 1.2, .7]})
        out = tiers(d, np.array([ELEVATED, CALM, .5, .1]))
        self.assertEqual(out["elevated"]["samples"], 1)
        self.assertEqual(out["calm"]["samples"], 2)
        self.assertEqual(out["calm"]["precision"], 1.0)


if __name__ == "__main__":
    unittest.main()
