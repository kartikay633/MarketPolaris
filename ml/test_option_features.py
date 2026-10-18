"""Implied-volatility mechanics and point-in-time rules. Synthetic fixtures only."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml.fo_history import COLUMNS, normalise, read_day, symbol_map
from ml.option_features import (MIN_DAYS, TARGET_DAYS, add_option_features, atm_iv_table, black76, constant_maturity,
                                implied_vol)

CAL = pd.bdate_range("2026-01-05", periods=60)
EXPIRIES = pd.to_datetime(["2026-01-29", "2026-02-26", "2026-03-26", "2026-04-30", "2026-05-28"])


def contracts(date, symbol, spot, sigma_of):
    """Futures and a strike ladder priced by Black-76 at sigma_of(days to expiry)."""
    rows = []
    for expiry in [e for e in EXPIRIES if e > date][:3]:
        days = (expiry - date).days
        F = spot * (1 + .065 * days / 365)
        rows.append({"symbol": symbol, "kind": "FUT", "expiry": expiry, "strike": 0., "close": F, "settle": F, "volume": 10,
                     "oi": 100, "underlying": spot})
        for K in np.arange(round(spot * .9 / 10) * 10, spot * 1.1, 10.):
            for kind in ("CE", "PE"):
                price = float(black76(F, K, days / 365, sigma_of(days), kind == "CE"))
                rows.append({"symbol": symbol, "kind": kind, "expiry": expiry, "strike": K, "close": round(price, 4),
                             "settle": price, "volume": 5, "oi": 50, "underlying": spot})
    return rows


def write_days(root, sigma_of, symbol="ABC", spot=1003., dates=CAL):
    folder = Path(root) / "fo-history" / "days"
    folder.mkdir(parents=True, exist_ok=True)
    for date in dates:
        s = lambda days, v=sigma_of(date): v
        pd.DataFrame(contracts(date, symbol, spot, s), columns=COLUMNS).to_csv(folder / f"{date.date()}.csv.gz", index=False,
                                                                                date_format="%Y-%m-%d")


def panel(dates=CAL, symbols=("ABC",)):
    long = pd.DataFrame([(d, s) for d in dates for s in symbols], columns=["date", "symbol"])
    long["normal_vol"], long["raw_vol_20"] = .015, .02
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    return long, (lambda frame: frame.stack(future_stack=True).reindex(idx).to_numpy())


class ImpliedVolTests(unittest.TestCase):
    def test_bisection_recovers_black76_volatility(self):
        F, K, T = np.array([100., 100., 100.]), np.array([90., 100., 115.]), np.array([.05, .1, .3])
        for call in (True, False):
            price = black76(F, K, T, np.array([.2, .35, .6]), call)
            np.testing.assert_allclose(implied_vol(price, F, K, T, np.repeat(call, 3)), [.2, .35, .6], atol=1e-6)

    def test_prices_below_intrinsic_value_are_rejected(self):
        self.assertTrue(np.isnan(implied_vol([5.], [100.], [90.], [.1], [True]))[0])

    def test_total_variance_interpolates_to_twenty_sessions_and_skips_expiring_month(self):
        atm = pd.DataFrame({"symbol": ["A", "A", "B", "B", "B"], "days": [14., 42., 3., 31., 59.], "iv": [.3, .2, .9, .25, .22]})
        cm = constant_maturity(atm)
        w = (TARGET_DAYS - 14) / (42 - 14)
        expected = np.sqrt((.3 ** 2 * 14 + w * (.2 ** 2 * 42 - .3 ** 2 * 14)) / TARGET_DAYS)
        self.assertAlmostEqual(cm.loc["A", "iv"], expected)
        self.assertLess(3, MIN_DAYS)
        self.assertAlmostEqual(cm.loc["B", "iv"], .25)  # 3-day expiry ignored; 31 days is past the target
        self.assertAlmostEqual(cm.loc["B", "iv_next"], .22)

    def test_end_to_end_atm_volatility_from_a_strike_ladder(self):
        with tempfile.TemporaryDirectory() as root:
            write_days(root, lambda date: .3, dates=CAL[:3])
            table = atm_iv_table(root, ["ABC"])
            np.testing.assert_allclose(table.iv, .3, atol=2e-3)
            self.assertTrue(any((Path(root) / "fo-history").glob("atm-iv-*.csv.gz")))
            np.testing.assert_allclose(atm_iv_table(root, ["ABC"]).iv, table.iv)  # cached result is reused

    def test_untraded_options_do_not_count(self):
        with tempfile.TemporaryDirectory() as root:
            write_days(root, lambda date: .3, dates=CAL[:1])
            path = next((Path(root) / "fo-history" / "days").glob("*.csv.gz"))
            d = pd.read_csv(path)
            d.loc[d.kind != "FUT", "volume"] = 0
            d.to_csv(path, index=False)
            self.assertTrue(atm_iv_table(root, ["ABC"]).iv.isna().all())


class OptionLeakageTests(unittest.TestCase):
    def test_later_option_prices_do_not_change_earlier_features(self):
        cut = CAL[40]
        sigma = lambda date: .25 + .1 * np.sin(CAL.get_loc(date) / 5)
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            write_days(a, sigma)
            write_days(b, lambda date: sigma(date) * (3 if date > cut else 1))
            frames = []
            for root in (a, b):
                long, pick = panel()
                frames.append(add_option_features(long, root, CAL, ["ABC"], pick))
            cols = [c for c in frames[0] if c.startswith("o_")]
            self.assertTrue(frames[0].o_iv_vs_median.isna().all())  # needs 120 sessions of history
            pd.testing.assert_frame_equal(frames[0].loc[frames[0].date <= cut, cols], frames[1].loc[frames[1].date <= cut, cols])
            self.assertFalse(frames[0].loc[frames[0].date > cut, "o_iv"].equals(frames[1].loc[frames[1].date > cut, "o_iv"]))

    def test_missing_day_is_carried_at_most_three_sessions(self):
        with tempfile.TemporaryDirectory() as root:
            write_days(root, lambda date: .3, dates=CAL[:5])
            long, pick = panel(CAL[:12])
            out = add_option_features(long, root, CAL[:12], ["ABC"], pick)
            self.assertEqual(out.o_has_iv.tolist(), [1.] * 8 + [0.] * 4)

    def test_stocks_without_options_stay_missing(self):
        with tempfile.TemporaryDirectory() as root:
            write_days(root, lambda date: .3, dates=CAL[:3])
            long, pick = panel(CAL[:3], ("ABC", "XYZ"))
            out = add_option_features(long, root, CAL[:3], ["ABC", "XYZ"], pick)
            self.assertTrue(out.loc[out.symbol == "XYZ", "o_lr_iv"].isna().all())
            self.assertTrue((out.loc[out.symbol == "XYZ", "o_has_iv"] == 0).all())
            row = out.loc[out.symbol == "ABC"].iloc[0]
            self.assertAlmostEqual(row.o_lr_iv, np.log(row.o_iv / np.sqrt(252) / .015))
            self.assertAlmostEqual(row.o_iv_minus_rv, row.o_iv - .02 * np.sqrt(252))


class CollectorTests(unittest.TestCase):
    def test_rename_applies_only_before_the_effective_date(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / "fo-history"
            folder.mkdir()
            (folder / "symbol-changes.csv").write_text("NAME OF THE COMPANY,OLD SYMBOL,NEW SYMBOL,EFFECTIVE DATE\n"
                                                      "Abc Ltd,OLDABC,ABC,07-JAN-2026\n", encoding="utf-8")
            mapping = symbol_map(root, {"ABC"})
            write_days(root, lambda date: .3, symbol="OLDABC", dates=CAL[:4])
            days = sorted((folder / "days").glob("*.csv.gz"))
            self.assertEqual(set(read_day(days[0], mapping, {"ABC"}).symbol), {"ABC"})
            self.assertTrue(read_day(days[3], mapping, {"ABC"}).empty)  # a reused old ticker is a different company

    def test_both_bhavcopy_formats_share_one_schema_and_drop_index_contracts(self):
        legacy = pd.DataFrame({"INSTRUMENT": ["FUTSTK", "OPTSTK", "OPTSTK", "OPTIDX"], "SYMBOL": ["ABC"] * 3 + ["NIFTY"],
                               "EXPIRY_DT": ["29-Jan-2026"] * 4, "STRIKE_PR": [0, 100, 110, 20000], "OPTION_TYP": ["XX", "CE", "PE", "CE"],
                               "CLOSE": [101, 4, 9, 100], "SETTLE_PR": [101, 4, 9, 100], "CONTRACTS": [5, 3, 0, 9],
                               "OPEN_INT": [1, 1, 1, 1]})
        udiff = pd.DataFrame({"FinInstrmTp": ["STF", "STO", "STO", "IDO"], "TckrSymb": ["ABC"] * 3 + ["NIFTY"],
                              "XpryDt": ["2026-01-29"] * 4, "StrkPric": [np.nan, 100, 110, 20000], "OptnTp": [np.nan, "CE", "PE", "CE"],
                              "ClsPric": [101, 4, 9, 100], "SttlmPric": [101, 4, 9, 100], "TtlTradgVol": [5, 3, 0, 9],
                              "OpnIntrst": [1, 1, 1, 1], "UndrlygPric": [100.5] * 4})
        a, b = normalise(legacy), normalise(udiff)
        self.assertEqual(list(a.columns), COLUMNS)
        self.assertEqual(a.kind.tolist(), ["CE", "FUT"])  # untraded put and index option dropped
        pd.testing.assert_frame_equal(a.drop(columns="underlying"), b.drop(columns="underlying"), check_dtype=False)


if __name__ == "__main__":
    unittest.main()
