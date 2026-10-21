"""Tests for the wide data cleaning (amendment 1c, ml.wide.clean) and the v5 search helpers (ml.v5)."""
import unittest

import numpy as np
import pandas as pd

import ml.v5 as v5
import ml.wide as wide


def frame(closes, start="2014-06-02", volume=1000.):
    idx = pd.bdate_range(start, periods=len(closes))
    c = pd.Series(np.asarray(closes, dtype=float), index=idx)
    vol = pd.Series(volume, index=idx, dtype=float) if np.isscalar(volume) else pd.Series(volume, index=idx, dtype=float)
    return pd.DataFrame({"open": c, "high": c * 1.01, "low": c * .99, "close": c, "volume": vol})


class CleanTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.fine = 100 * np.exp(np.cumsum(rng.normal(0, .015, 400)))

    def test_no_trade_sessions_are_dropped(self):
        volume = np.full(400, 1000.)
        volume[[50, 51, 200]] = 0
        out, _, stats = wide.clean({"S": frame(self.fine, volume=volume)}, {"S": {}})
        self.assertEqual(len(out["S"]), 397)
        self.assertEqual(stats["zeroVolumeRowsDropped"], 3)

    def test_coarse_prices_are_dropped_and_fine_ones_kept(self):
        # ₹2 stock on a ₹0.50 grid (25% steps), then a normal stock: only the coarse stretch goes.
        coarse = 2 + .5 * np.round(np.random.default_rng(1).normal(0, 1, 150))
        coarse = np.clip(coarse, .5, None)
        out, _, stats = wide.clean({"S": frame(np.concatenate([coarse, self.fine]))}, {"S": {}})
        kept = out["S"]
        self.assertGreater(stats["coarsePriceRowsDropped"], 100)
        self.assertTrue((kept.close.iloc[-300:] > 10).all())
        self.assertGreaterEqual(len(kept), 360)

    def test_coarseness_uses_only_past_sessions(self):
        prices = np.concatenate([np.clip(2 + .5 * np.round(np.random.default_rng(2).normal(0, 1, 120)), .5, None), self.fine])
        full, _, _ = wide.clean({"S": frame(prices)}, {"S": {}})
        for cut in (150, 200, 300):
            early, _, _ = wide.clean({"S": frame(prices[:cut])}, {"S": {}})
            shared = full["S"].index[full["S"].index <= early["S"].index.max()]
            self.assertTrue(early["S"].index.equals(shared), f"rows kept up to session {cut} changed with later prices")

    def test_seam_gap_is_an_event(self):
        idx = pd.bdate_range("2014-10-01", "2015-03-31")
        c = pd.Series(100., index=idx) * np.exp(np.cumsum(np.random.default_rng(3).normal(0, .01, len(idx))))
        c[c.index >= "2015-01-01"] *= 1.25  # a missed 1:4 bonus adjustment
        f = pd.DataFrame({"open": c, "high": c * 1.01, "low": c * .99, "close": c, "volume": 1000.})
        _, seam, _ = wide.clean({"S": f, "QUIET": f.assign(open=f.close.shift(1).fillna(f.close))}, {"S": {}, "QUIET": {}})
        self.assertIn(("S", "2015-01-01"), seam)
        self.assertNotIn(("QUIET", "2015-01-01"), seam)

    def test_benchmarks_are_untouched(self):
        f = frame(self.fine, volume=0.)
        out, _, _ = wide.clean({"NIFTY_50": f}, {"NIFTY_50": {"benchmark": True}})
        self.assertEqual(len(out["NIFTY_50"]), len(f))


class SearchHelperTest(unittest.TestCase):
    def panel(self, days=30, stocks=50):
        dates = np.repeat(pd.bdate_range("2020-01-01", periods=days), stocks)
        rng = np.random.default_rng(4)
        return pd.DataFrame({"date": dates, "symbol": np.tile([f"S{i}" for i in range(stocks)], days),
                             "raw_log_turnover_20": rng.normal(18, 2, days * stocks), "excess": rng.normal(0, .05, days * stocks)})

    def test_tradable_is_the_top_ninety_percent_of_each_date(self):
        d = self.panel()
        share = v5.tradable(d).groupby(d.date).mean()
        self.assertTrue(np.allclose(share, .9, atol=.021))

    def test_rank_target_is_within_each_date(self):
        d = self.panel()
        t = pd.Series(v5._target(d, "rank"))
        self.assertTrue(((t > -.5) & (t <= .5)).all())
        by_date = t.groupby(d.date.to_numpy()).mean()
        self.assertTrue(np.allclose(by_date, by_date.iloc[0], atol=.02))

    def test_training_window_and_recency_weights_use_past_dates_only(self):
        d = self.panel(days=100, stocks=3)
        idx = np.arange(len(d))
        start = d.date.max() + pd.Timedelta(days=1)
        rows, weight = v5.training_rows(d, idx, {"window": 20}, start)
        self.assertEqual(d.date.iloc[rows].nunique(), 20)
        rows, weight = v5.training_rows(d, idx, {"halflife": 10}, start)
        newest, older = weight[d.date.iloc[rows] == d.date.max()], weight[d.date.iloc[rows] == d.date.unique()[-11]]
        self.assertAlmostEqual(float(older.mean() / newest.mean()), .5, places=6)

    def test_version_is_stable_across_refits(self):
        a = v5.version({"risk": "r-ensemble", "rank": "k-hgb"})
        self.assertEqual(a, v5.version({"rank": "k-hgb", "risk": "r-ensemble"}))
        self.assertNotEqual(a, v5.version({"risk": "r-logit", "rank": "k-hgb"}))


if __name__ == "__main__":
    unittest.main()
