"""Point-in-time rules for delivery and bulk/block-deal inputs. Synthetic fixtures only."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml.flow_features import FEATURES, STOCK, add_flow_features, flow_frames
from ml.flow_history import normalise_delivery, parse_deals, parse_mto

CAL = pd.bdate_range("2025-01-01", periods=160)
STOCKS = ["AAA", "BBB", "NEWCO"]


def write_flow(root, shift=None, deals=True):
    """Delivery files for every session and deals on a few; values from `shift` on are perturbed."""
    folder = Path(root) / "flow-history"
    (folder / "delivery").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(3)
    for day in CAL:
        traded = rng.integers(1e5, 1e6, 3).astype(float)
        delivered = traded * rng.uniform(.2, .7, 3)
        if shift is not None and day >= shift:
            delivered = traded * .99
        # OLDCO renamed to NEWCO on CAL[80]; a different company reuses OLDCO afterwards.
        symbols = ["AAA", "BBB", "OLDCO" if day < CAL[80] else "NEWCO"]
        d = pd.DataFrame({"symbol": symbols + (["OLDCO"] if day >= CAL[80] else []),
                          "series": "EQ", "traded": list(traded) + ([5e7] if day >= CAL[80] else []),
                          "delivered": list(delivered) + ([5e7] if day >= CAL[80] else [])})
        d["delivPct"] = d.delivered / d.traded * 100
        d.to_csv(folder / "delivery" / f"{day.date()}.csv.gz", index=False, compression="gzip")
    (Path(root) / "fo-history").mkdir(exist_ok=True)
    pd.DataFrame({"SM_KEY_SYMBOL": ["OLDCO"], "OLD SYMBOL": ["OLDCO"], "NEW SYMBOL": ["NEWCO"],
                  "EFFECTIVE DATE": [CAL[80].strftime("%d-%b-%Y").upper()]}).to_csv(Path(root) / "fo-history" / "symbol-changes.csv", index=False)
    if deals:
        (folder / "deals").mkdir(exist_ok=True)
        saturday = CAL[60] + pd.Timedelta(days=5 - CAL[60].dayofweek)
        rows = [(CAL[40], "AAA", "BUY", 1e6), (CAL[40], "AAA", "SELL", 2e5), (CAL[120], "BBB", "BUY", 3e6), (saturday, "BBB", "BUY", 1e5)]
        if shift is not None:
            rows += [(shift, "AAA", "BUY", 9e9), (shift + pd.Timedelta(days=3), "BBB", "SELL", 9e9)]
        d = pd.DataFrame([(t.date().isoformat(), s, "X", side, q, 10.) for t, s, side, q in rows], columns=["date", "symbol", "client", "side", "qty", "price"])
        month = pd.to_datetime(d.date).dt.strftime("%Y-%m")
        for m in pd.Series(CAL).dt.strftime("%Y-%m").unique():
            d.loc[month == m].to_csv(folder / "deals" / f"bulk-{m}.csv.gz", index=False, compression="gzip")
            d.iloc[0:0].to_csv(folder / "deals" / f"block-{m}.csv.gz", index=False, compression="gzip")


def panel(root, ranks=False):
    long = pd.DataFrame([(d, s) for d in CAL for s in STOCKS], columns=["date", "symbol"])
    idx = pd.MultiIndex.from_arrays([long.date, long.symbol])
    return add_flow_features(long, root, CAL, STOCKS, lambda f: f.stack(future_stack=True).reindex(idx).to_numpy(), ranks)


class FlowFeatureTests(unittest.TestCase):
    def test_later_delivery_and_deals_do_not_change_earlier_features(self):
        cut = CAL[110]
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            write_flow(a)
            write_flow(b, shift=CAL[111])  # every delivery figure and an extra deal from the next session on
            pa, pb = panel(a, True), panel(b, True)
            cols = FEATURES + [f"cs_{k}" for k in STOCK]
            keep = lambda p: p.loc[p.date <= cut, cols].reset_index(drop=True)
            pd.testing.assert_frame_equal(keep(pa), keep(pb))
            self.assertFalse(np.allclose(pa.loc[pa.date == CAL[111], "fl_dp"], pb.loc[pb.date == CAL[111], "fl_dp"]))
            self.assertTrue(pa.loc[pa.date == cut, "fl_dp5_vs60"].notna().all())

    def test_session_data_counts_on_its_own_date(self):
        with tempfile.TemporaryDirectory() as root:
            write_flow(root)
            p = panel(root).set_index(["date", "symbol"])
            raw = pd.read_csv(Path(root) / "flow-history" / "delivery" / f"{CAL[50].date()}.csv.gz").set_index("symbol")
            self.assertAlmostEqual(p.loc[(CAL[50], "AAA"), "fl_dp"], raw.loc["AAA", "delivered"] / raw.loc["AAA", "traded"])
            self.assertEqual(p.loc[(CAL[39], "AAA"), "fl_deal_any5"], 0)
            self.assertEqual(p.loc[(CAL[40], "AAA"), "fl_deal_any5"], 1)
            self.assertEqual(p.loc[(CAL[40], "AAA"), "fl_bulk_n20"], np.log1p(2))
            self.assertAlmostEqual(p.loc[(CAL[40], "AAA"), "fl_deal_net20"] * p.loc[(CAL[40], "AAA"), "fl_deal_gross20"] ** -1, 8e5 / 1.2e6)

    def test_weekend_deal_counts_from_next_session(self):
        with tempfile.TemporaryDirectory() as root:
            write_flow(root)
            p = panel(root).set_index(["date", "symbol"])
            friday = CAL[60] + pd.Timedelta(days=4 - CAL[60].dayofweek)
            self.assertEqual(p.loc[(friday, "BBB"), "fl_deal_any5"], 0)
            self.assertEqual(p.loc[(friday + pd.Timedelta(days=3), "BBB"), "fl_deal_any5"], 1)

    def test_symbol_change_applies_only_before_effective_date(self):
        with tempfile.TemporaryDirectory() as root:
            write_flow(root)
            p = panel(root).set_index(["date", "symbol"])
            # Before the change OLDCO's rows are NEWCO's history; afterwards the reused ticker is ignored.
            self.assertTrue(p.loc[(CAL[79], "NEWCO"), "fl_dp"] < .8)
            self.assertTrue(p.loc[(CAL[81], "NEWCO"), "fl_dp"] < .8)

    def test_missing_flow_data_leaves_inputs_missing(self):
        with tempfile.TemporaryDirectory() as root:
            out = panel(root)
            self.assertTrue(out[[k for k in FEATURES if k != "fl_has_delivery"]].isna().all().all())
            self.assertTrue((out.fl_has_delivery == 0).all())

    def test_missing_deal_month_is_missing_not_zero(self):
        with tempfile.TemporaryDirectory() as root:
            write_flow(root, deals=False)
            f = flow_frames(root, CAL, STOCKS)
            self.assertTrue(f["fl_bulk_n20"].isna().all().all())
            self.assertTrue(f["fl_dp"].notna().all().all())


class ParserTests(unittest.TestCase):
    def test_mto_layout(self):
        raw = (b"Security Wise Delivery Position - Compulsory Rolling Settlement\n10,MTO,03102016,1,1\n"
               b"Trade Date <03-OCT-2016>,Settlement Type <N>\nRecord Type,Sr No,Name of Security,Quantity Traded,"
               b"Deliverable Quantity(gross across client level),% of Deliverable Quantity to Traded Quantity\n"
               b"20,1,20MICRONS,EQ,107724,93126,86.45\n20,2,SOMEBOND,N1,10,10,100.00\n")
        d = normalise_delivery(parse_mto(raw))
        self.assertEqual(d.symbol.tolist(), ["20MICRONS"])
        self.assertEqual(d.delivered.iloc[0], 93126)

    def test_deal_csv_and_empty_report(self):
        raw = ('﻿"Date ","Symbol ","Security Name ","Client Name ","Buy / Sell ","Quantity Traded ",'
               '"Trade Price / Wght. Avg. Price ","Remarks "\n"16-OCT-2026","AAA","A Ltd","X","BUY","65,000","113.66","-"\n').encode()
        d = parse_deals(raw)
        self.assertEqual((d.date.iloc[0], d.qty.iloc[0], d.side.iloc[0]), ("2026-10-16", 65000, "BUY"))
        empty = b'"Date","Symbol","Security Name","Client Name","Buy / Sell","Quantity Traded","Trade Price / Wght. Avg. Price"\nNO RECORDS,,,,,,\n'
        self.assertTrue(parse_deals(empty).empty)


if __name__ == "__main__":
    unittest.main()
