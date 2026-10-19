"""Correctness and no-lookahead tests for the v5 candidate inputs (ml.v5_features)."""
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml import v5_features as v5


def session(date, closes, volume=100):
    t = pd.date_range(f"{date} 09:15", periods=len(closes), freq="1min")
    c = np.asarray(closes, dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    return pd.DataFrame({"time": t, "open": o, "high": np.maximum(o, c) * 1.0001, "low": np.minimum(o, c) * .9999,
                         "close": c, "volume": volume})


class SessionSummaryTest(unittest.TestCase):
    def test_short_sessions_are_left_out(self):
        self.assertIsNone(v5.session_summary(session("2024-01-02", np.full(60, 100.))))

    def test_sell_off_and_recovery(self):
        path = np.concatenate([np.linspace(100, 90, 150), np.linspace(90, 98, 225)])
        s = v5.session_summary(session("2024-01-02", path))
        self.assertAlmostEqual(s["mdd"], np.log(100 / 90), places=3)
        self.assertAlmostEqual(s["rebound"], np.log(98 / (90 * .9999)), places=3)
        self.assertGreater(s["down_share"], .5)
        self.assertTrue(0 <= s["jump_share"] <= 1)
        self.assertAlmostEqual(s["last30_volume"], 30 / 375, places=6)

    def test_realised_volatility_uses_five_minute_returns(self):
        rng = np.random.default_rng(0)
        r = rng.normal(0, .001, 375)
        s = v5.session_summary(session("2024-01-02", 100 * np.exp(np.cumsum(r))))
        c = 100 * np.exp(np.cumsum(r))
        five = np.diff(np.log(np.concatenate([[c[0]], c[4::5]])))
        self.assertAlmostEqual(s["rv"], np.sqrt(np.sum(five ** 2)), places=6)


class IntradayPointInTimeTest(unittest.TestCase):
    def test_features_at_t_ignore_later_sessions(self):
        days = pd.bdate_range("2024-01-01", periods=40)
        rng = np.random.default_rng(1)
        base = {sym: rng.normal(0, .001, (40, 375)) for sym in ("AAA", "NIFTY_50", "INDIA_VIX")}
        with tempfile.TemporaryDirectory() as minutes, tempfile.TemporaryDirectory() as root:
            old = os.environ.get("PULSE_MINUTE_DIR")
            os.environ["PULSE_MINUTE_DIR"] = minutes

            def write(shock):
                for sym in ("AAA", "NIFTY_50", "INDIA_VIX"):
                    frames = []
                    for i, d in enumerate(days):
                        scale = 10 if (shock and i >= 30) else 1
                        frames.append(session(d.date(), 100 * np.exp(np.cumsum(base[sym][i] * scale))))
                    Path(minutes, sym).mkdir(exist_ok=True)
                    df = pd.concat(frames)
                    df["time"] = df.time.dt.strftime("%Y-%m-%dT%H:%M:00+05:30")
                    df.to_csv(Path(minutes, sym, "2024-01.csv.gz"), index=False, compression="gzip")
                for f in Path(root).glob("intraday/*"):
                    f.unlink()

            def features():
                long = pd.DataFrame({"date": days, "symbol": "AAA", "normal_vol": .01})
                closes = pd.DataFrame({"AAA": np.linspace(100, 110, 40)}, index=days)
                idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
                pick = lambda f: f.stack(future_stack=True).reindex(idx).to_numpy()
                return v5.add_intraday_features(long, root, days, ["AAA"], closes, pick)

            try:
                write(False)
                calm = features()
                write(True)
                shocked = features()
            finally:
                if old is None:
                    os.environ.pop("PULSE_MINUTE_DIR")
                else:
                    os.environ["PULSE_MINUTE_DIR"] = old
            cols = v5.INTRADAY + ["m_panic1", "m_rebound1"]
            # Sessions from index 30 are 10x more volatile in the second run; nothing before them may change.
            pd.testing.assert_frame_equal(calm.loc[:29, cols], shocked.loc[:29, cols])
            self.assertGreater(shocked.i_rv1.iloc[35], calm.i_rv1.iloc[35] + 1)
            self.assertTrue(np.all(np.isfinite(shocked.loc[25:29, "i_rv22"])))
            self.assertEqual(int(shocked.i_has.sum()), 40)
            self.assertTrue(set(cols) <= set(shocked.columns))


class LookaheadTest(unittest.TestCase):
    def test_rolling_inputs_are_backward_only(self):
        days = pd.bdate_range("2024-01-01", periods=30)
        wide = pd.DataFrame({"AAA": np.arange(30.)}, index=days)
        changed = wide.copy()
        changed.iloc[20:] = 1e6
        roll = lambda x: x.rolling(5, min_periods=4).mean()
        pd.testing.assert_frame_equal(roll(wide).iloc[:20], roll(changed).iloc[:20])


class SurfaceTest(unittest.TestCase):
    def test_put_skew_from_expensive_downside(self):
        from ml.option_features import black76
        date, expiry, F = pd.Timestamp("2024-03-01"), pd.Timestamp("2024-03-28"), 100.
        T = (expiry - date).days / 365
        rows = [{"symbol": "AAA", "kind": "FUT", "expiry": expiry, "strike": 0., "close": F, "settle": F, "volume": 10, "oi": 1000, "underlying": F}]
        for K in range(85, 116, 2):
            for kind in ("CE", "PE"):
                vol = .30 + max(0, (100 - K) / 100) * 2  # downside strikes priced richer
                price = float(black76(F, K, T, vol, kind == "CE"))
                rows.append({"symbol": "AAA", "kind": kind, "expiry": expiry, "strike": float(K), "close": price, "settle": price,
                             "volume": 5, "oi": 300 if kind == "PE" else 100, "underlying": F})
        s = v5.surface_day(pd.DataFrame(rows), date).iloc[0]
        self.assertGreater(s.put_skew, .05)
        self.assertLess(abs(s.call_skew), .01)
        self.assertAlmostEqual(s.pcr_oi, np.log(3), places=6)

    def test_interpolation_and_tolerance(self):
        k = pd.DataFrame({"m": [-.1, 0., .1], "iv": [.4, .3, .35]})
        self.assertAlmostEqual(v5.interpolate_iv(k, -.05), .35)
        self.assertTrue(np.isnan(v5.interpolate_iv(k.iloc[1:], -.06)))


if __name__ == "__main__":
    unittest.main()
