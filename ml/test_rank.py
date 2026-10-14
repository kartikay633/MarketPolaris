"""Synthetic fixtures validate mechanics only; these are not model evidence."""
import unittest

import numpy as np
import pandas as pd

from ml.rank import (FEATURES, HORIZONS, MIN_STOCKS_PER_DATE, build_panel, horizon_frame,
                     selective, split_dates)


def universe(n_stocks=MIN_STOCKS_PER_DATE + 5, n_days=420, seed=1):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2019-01-01", periods=n_days)
    frames, meta = {}, {}
    for i in range(n_stocks + 1):
        close = 100 * np.exp(np.cumsum(rng.normal(0, .015, n_days)))
        open_ = close * np.exp(rng.normal(0, .004, n_days))
        frames[f"S{i}" if i else "NIFTY_50"] = pd.DataFrame({
            "open": open_, "close": close, "high": np.maximum(open_, close) * 1.01,
            "low": np.minimum(open_, close) * .99, "volume": rng.integers(1000, 5000, n_days).astype(float)}, index=dates)
        meta[f"S{i}" if i else "NIFTY_50"] = {"benchmark": i == 0, "sector": "A" if i % 2 else "B"}
    return frames, meta


class RankLeakageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames, cls.meta = universe()
        cls.panel = build_panel(cls.frames, cls.meta)

    def test_future_prices_do_not_change_past_features(self):
        cut = self.frames["NIFTY_50"].index[330]
        changed = {k: v.copy() for k, v in self.frames.items()}
        for frame in changed.values():
            frame.loc[frame.index > cut, ["open", "high", "low", "close"]] *= np.linspace(.5, 3, (frame.index > cut).sum())[:, None]
            frame.loc[frame.index > cut, "volume"] *= 7
        after = build_panel(changed, self.meta)
        cols = ["date", "symbol"] + FEATURES
        a = self.panel.loc[self.panel.date <= cut, cols].reset_index(drop=True)
        b = after.loc[after.date <= cut, cols].reset_index(drop=True)
        pd.testing.assert_frame_equal(a, b)

    def test_label_is_next_open_to_horizon_close(self):
        row = self.panel.dropna(subset=["fwd_5"]).iloc[100]
        stock = self.frames[row.symbol]
        i = stock.index.get_loc(row.date)
        self.assertAlmostEqual(row.fwd_5, stock.close.iloc[i + 5] / stock.open.iloc[i + 1] - 1)
        self.assertEqual(pd.Timestamp(row.labelEnd_5), stock.index[i + 5])

    def test_missing_future_session_makes_label_unscorable(self):
        frames = {k: v.copy() for k, v in self.frames.items()}
        missing = frames["S1"].index[350]
        frames["S1"] = frames["S1"].drop(missing)
        panel = build_panel(frames, self.meta)
        rows = panel.loc[(panel.symbol == "S1") & panel.date.between(frames["NIFTY_50"].index[345], frames["NIFTY_50"].index[349])]
        self.assertTrue(rows.fwd_5.isna().all())

    def test_purged_splits_never_overlap_labels(self):
        for h in HORIZONS:
            d = horizon_frame(self.panel, h)
            dev, holdout, starts = split_dates(d)
            self.assertLess(dev.labelEnd.max(), holdout.date.min())
            for start in starts[:-1]:
                self.assertLess(dev.loc[dev.labelEnd < start].labelEnd.max(), start)

    def test_peer_target_is_balanced_per_date(self):
        d = horizon_frame(self.panel, 5)
        share = d.groupby("date").y_peer.mean()
        self.assertTrue(share.between(.4, .6).all())

    def test_selective_accuracy_keeps_most_confident_rows(self):
        y = np.array([1, 0, 1, 0])
        p = np.array([.9, .45, .55, .2])
        rows = selective(y, p)
        self.assertEqual(rows[-1]["samples"], 4)
        self.assertEqual(rows[0]["accuracy"], 1.0)


if __name__ == "__main__":
    unittest.main()
