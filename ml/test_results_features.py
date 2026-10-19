"""Point-in-time rules for reported-results inputs. Synthetic fixtures only."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml.results_features import FEATURES, QUARTER, STALE_DAYS, known_times, results_features
from ml.results_history import choose, filings, parse_xbrl

CAL = pd.bdate_range("2021-01-01", "2024-12-31")
STOCKS = ["AAA", "BBB"]


def quarters(symbol="AAA", n=14, first="2021-03-31", profit_growth=.1, seed=0):
    """Quarterly filings disseminated 20 days after each quarter at 16:00."""
    rng = np.random.default_rng(seed)
    ends = pd.date_range(first, periods=n, freq="QE")
    rev = 1000 * (1.05 ** np.arange(n)) * (1 + rng.normal(0, .02, n))
    profit = 100 * ((1 + profit_growth) ** np.arange(n)) * (1 + rng.normal(0, .1, n))
    return pd.DataFrame({"symbol": symbol, "periodEnd": ends, "disseminated": ends + pd.Timedelta(days=20, hours=16),
                         "revenue": rev, "profit": profit, "eps": profit / 10, "boardMeeting": ends + pd.Timedelta(days=20)})


def frame(q, disclosures=None, meetings=None, timing="announcement"):
    f = results_features(None, CAL, STOCKS, disclosures, timing, quarters=q, meetings=meetings)
    return pd.DataFrame({k: v["AAA"] for k, v in f.items()})


def no_disclosures():
    return pd.DataFrame(columns=["symbol", "seq", "ts", "category", "text"])


class ResultsFeatureTests(unittest.TestCase):
    def test_numbers_count_from_the_18_00_cutoff(self):
        q = quarters()
        i = 8
        day = q.periodEnd[i] + pd.Timedelta(days=20)
        while day not in CAL:
            day += pd.Timedelta(days=1)
        nxt = CAL[CAL.get_loc(day) + 1]
        for stamp, first in (("17:59:00", day), ("18:01:00", nxt)):
            q2 = q.copy()
            q2.loc[i, "disseminated"] = pd.Timestamp(f"{day.date()} {stamp}")
            q2.loc[i, "boardMeeting"] = day
            f = frame(q2, timing="xbrl")
            prev = CAL[CAL.get_loc(first) - 1]
            self.assertEqual(f.res_sess_since[first], 0)
            self.assertGreater(f.res_sess_since[prev], 0)
            self.assertNotEqual(f.res_np_yoy[prev], f.res_np_yoy[first])

    def test_future_filings_do_not_change_features(self):
        q = quarters()
        cut = pd.Timestamp("2023-06-01")
        later = q.disseminated > cut
        perturbed = q.copy()
        perturbed.loc[later, ["revenue", "profit", "eps"]] *= -3
        perturbed.loc[later, "disseminated"] -= pd.Timedelta(days=5)  # still after the cut
        perturbed.loc[later & (perturbed.disseminated <= cut), "disseminated"] = cut + pd.Timedelta(hours=19)
        a, b = frame(q, timing="xbrl"), frame(perturbed, timing="xbrl")
        pd.testing.assert_frame_equal(a.loc[:cut], b.loc[:cut])
        self.assertTrue(a.loc[:cut, "res_sue"].notna().any())

    def test_announcement_counts_only_from_the_results_meeting(self):
        q = quarters()
        i = 8
        meeting = pd.Timestamp("2023-04-20")  # a Thursday
        q.loc[i, ["boardMeeting", "disseminated"]] = [meeting, pd.Timestamp("2023-04-24 19:00")]
        early = pd.DataFrame({"symbol": "AAA", "seq": ["1", "2"], "category": ["Board Meeting Intimation", "Outcome of Board Meeting"],
                              "text": ["Board meeting to consider financial results", "Financial results for the quarter"],
                              "ts": pd.to_datetime(["2023-04-10 15:00", "2023-04-20 14:30"])})
        known = known_times(q, early)
        self.assertEqual(known[i], pd.Timestamp("2023-04-20 14:30"))  # the intimation before the meeting is ignored
        f = frame(q, early)
        self.assertEqual(f.res_sess_since[meeting], 0)
        self.assertNotEqual(f.res_np_yoy[meeting - pd.Timedelta(days=1)], f.res_np_yoy[meeting])
        late = early.assign(ts=pd.to_datetime(["2023-04-10 15:00", "2023-04-28 10:00"]))  # beyond three days: XBRL time
        self.assertEqual(known_times(q, late)[i], pd.Timestamp("2023-04-24 19:00"))
        q.loc[i, "periodEnd"] = pd.Timestamp("2023-03-31")
        other = early.assign(text=["", "Financial results for the quarter ended December 31, 2022"])  # another quarter
        self.assertEqual(known_times(q, other)[i], pd.Timestamp("2023-04-24 19:00"))
        same = early.assign(text=["", "Audited financial results for the quarter ended 31st March, 2023"])
        self.assertEqual(known_times(q, same)[i], pd.Timestamp("2023-04-20 14:30"))
        unrelated = early.assign(category=["", "Outcome of Board Meeting"], text=["", "Buyback approved by the board"])
        self.assertEqual(known_times(q, unrelated)[i], pd.Timestamp("2023-04-24 19:00"))

    def test_meeting_history_supplies_missing_meeting_dates(self):
        q = quarters()
        q["boardMeeting"] = pd.NaT
        i = 8
        meeting = q.periodEnd[i] + pd.Timedelta(days=10)
        q.loc[i, "disseminated"] = q.periodEnd[i] + pd.Timedelta(days=60)
        meetings = pd.DataFrame({"symbol": ["AAA"], "meeting": [meeting]})
        ann = pd.DataFrame({"symbol": ["AAA"], "seq": ["1"], "category": ["Outcome of Board Meeting"], "text": ["results"],
                            "ts": [meeting + pd.Timedelta(hours=15)]})
        self.assertEqual(known_times(q, ann, meetings=meetings)[i], meeting + pd.Timedelta(hours=15))
        self.assertEqual(known_times(q, ann)[i], q.disseminated[i])

    def test_year_ago_quarter_must_be_known_first(self):
        q = quarters()
        i = 8
        q.loc[i - 4, "disseminated"] = q.disseminated[i] + pd.Timedelta(days=1)  # year-ago filing arrives later
        f = frame(q, timing="xbrl")
        k = CAL[CAL.searchsorted(q.disseminated[i].normalize())]
        self.assertTrue(np.isnan(f.res_np_yoy[k]) and np.isnan(f.res_rev_yoy[k]))

    def test_yoy_and_surprise_values(self):
        q = quarters(n=13, seed=3)
        f = frame(q, timing="xbrl")
        i = 12
        k = CAL[CAL.searchsorted(q.disseminated[i].normalize())]
        p, p4 = q.profit[i], q.profit[i - 4]
        self.assertAlmostEqual(f.res_np_yoy[k], (p - p4) / ((abs(p) + abs(p4)) / 2))
        self.assertAlmostEqual(f.res_rev_yoy[k], np.log(q.revenue[i] / q.revenue[i - 4]))
        dp = np.array([q.profit[j] - q.profit[j - 4] for j in range(i - 1, 3, -1)])  # previous eight changes, newest first
        sue = (p - p4 - dp[:4].mean()) / dp.std(ddof=1)
        self.assertAlmostEqual(f.res_sue[k], np.clip(sue, -5, 5))

    def test_old_results_go_missing(self):
        q = quarters(n=6)
        f = frame(q, timing="xbrl")
        last = q.periodEnd.iloc[-1]
        stale = f.loc[last + pd.Timedelta(days=STALE_DAYS + 5):]
        self.assertTrue(stale[QUARTER].isna().all().all())
        self.assertTrue((stale.res_available == 0).all())
        self.assertTrue((f.loc[:q.disseminated[0].normalize() - pd.Timedelta(days=1), "res_available"] == 0).all())

    def test_without_data_inputs_are_missing(self):
        f = results_features(None, CAL, STOCKS, quarters=quarters().iloc[:0])
        self.assertEqual(set(f), set(FEATURES))
        self.assertTrue(all(f[k].isna().all().all() for k in FEATURES if k != "res_available"))


XBRL = """<?xml version="1.0"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:c="urn:x">
<xbrli:context id="SegD"><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2024-06-30</xbrli:endDate></xbrli:period>
<xbrli:scenario><xbrldi:explicitMember dimension="c:Seg">c:A</xbrldi:explicitMember></xbrli:scenario></xbrli:context>
<xbrli:context id="FourD"><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2024-06-30</xbrli:endDate></xbrli:period></xbrli:context>
<c:RevenueFromOperations contextRef="SegD">1</c:RevenueFromOperations>
<c:DateOfStartOfReportingPeriod contextRef="FourD">2023-04-01</c:DateOfStartOfReportingPeriod>
<c:DateOfEndOfReportingPeriod contextRef="FourD">2024-06-30</c:DateOfEndOfReportingPeriod>
<c:RevenueFromOperations contextRef="FourD">999</c:RevenueFromOperations>
<c:DateOfEndOfReportingPeriod contextRef="OneD">2024-06-30</c:DateOfEndOfReportingPeriod>
<c:DateOfBoardMeetingWhenFinancialResultsWereApproved contextRef="OneD">2024-07-20</c:DateOfBoardMeetingWhenFinancialResultsWereApproved>
<c:InterestEarned contextRef="OneD">250</c:InterestEarned>
<c:ProfitLossForThePeriod contextRef="OneD">-20</c:ProfitLossForThePeriod>
<c:BasicEarningsPerShareAfterExtraordinaryItems contextRef="OneD">-1.5</c:BasicEarningsPerShareAfterExtraordinaryItems>
</xbrli:xbrl>"""


class ResultsParsingTests(unittest.TestCase):
    def test_quarter_context_wins_over_segments_and_year_to_date(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "f.xml"
            path.write_text(XBRL, encoding="utf-8")
            v = parse_xbrl(path, pd.Timestamp("2024-06-30"))
            self.assertEqual((v["revenue"], v["profit"], v["eps"], v["boardMeeting"]), (250, -20, -1.5, "2024-07-20"))
            self.assertIsNone(parse_xbrl(path, pd.Timestamp("2024-03-31")))

    def test_earliest_filing_on_one_basis(self):
        legacy = [
            {"toDate": "30-Jun-2024", "consolidated": "Consolidated", "exchdisstime": "20-Jul-2024 15:00:00", "xbrl": "x/c1.xml", "seqNumber": 1},
            {"toDate": "30-Jun-2024", "consolidated": "Consolidated", "exchdisstime": "01-Aug-2024 15:00:00", "xbrl": "x/c1r.xml", "seqNumber": 2},
            {"toDate": "30-Jun-2024", "consolidated": "Non-Consolidated", "exchdisstime": "19-Jul-2024 15:00:00", "xbrl": "x/s1.xml", "seqNumber": 3},
            {"toDate": "31-Mar-2024", "consolidated": "Consolidated", "exchdisstime": "20-Apr-2024 15:00:00", "xbrl": "x/-", "seqNumber": 4},
        ]
        integrated = [{"qe_Date": "30-SEP-2024", "consolidated": "Consolidated", "broadcast_Date": "20-Oct-2024 15:00:00",
                       "xbrl": "x/c2.xml", "seq_Id": 5}]
        chosen, basis = choose(filings(legacy, integrated))
        self.assertEqual(basis, "consolidated")
        self.assertEqual(list(chosen.xbrl), ["x/c1.xml", "x/c2.xml"])


if __name__ == "__main__":
    unittest.main()
