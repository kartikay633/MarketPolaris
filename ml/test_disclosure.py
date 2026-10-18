"""Point-in-time rules for disclosure features. Synthetic fixtures only."""
import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from ml.disclosure_features import CAP, known_session, results_calendar
from ml.news_history import merge

CAL = pd.bdate_range("2026-01-05", periods=40)


def write_meetings(root, rows):
    folder = Path(root) / "news-history" / "board-meetings"
    folder.mkdir(parents=True)
    (folder / "ABC.json").write_text(json.dumps({"symbol": "ABC", "rows": rows}), encoding="utf-8")


class ResultsCalendarTests(unittest.TestCase):
    def test_intimation_counts_from_the_18_00_cutoff(self):
        stamps = pd.Series(pd.to_datetime(["2026-01-07 17:59:00", "2026-01-07 18:01:00", "2026-01-10 09:00:00"]))
        self.assertEqual(list(known_session(stamps, CAL)), [2, 3, 5])  # Sat 10 Jan maps to Mon 12 Jan

    def test_meeting_is_invisible_before_intimation_and_counts_down(self):
        with tempfile.TemporaryDirectory() as root:
            write_meetings(root, [{"bm_date": "16-Jan-2026", "bm_timestamp": "08-Jan-2026 19:30:00",
                                   "bm_purpose": "Financial Results", "bm_desc": "To consider quarterly results"}])
            cal = results_calendar(root, CAL, ["ABC"])
            to_next = cal["sess_to_results"]["ABC"]
            self.assertEqual(to_next[pd.Timestamp("2026-01-08")], CAP)  # filed after the cutoff that evening
            self.assertEqual(to_next[pd.Timestamp("2026-01-09")], 5)
            self.assertEqual(to_next[pd.Timestamp("2026-01-15")], 1)
            self.assertEqual(cal["results_in_20"]["ABC"][pd.Timestamp("2026-01-08")], 0)
            since = cal["sess_since_results"]["ABC"]
            self.assertTrue(pd.isna(since[pd.Timestamp("2026-01-15")]))
            self.assertEqual(since[pd.Timestamp("2026-01-16")], 0)
            self.assertEqual(since[pd.Timestamp("2026-01-20")], 2)

    def test_non_results_meetings_are_ignored(self):
        with tempfile.TemporaryDirectory() as root:
            write_meetings(root, [{"bm_date": "16-Jan-2026", "bm_timestamp": "05-Jan-2026 10:00:00",
                                   "bm_purpose": "Fund Raising", "bm_desc": "To consider issue of debentures"}])
            self.assertTrue((results_calendar(root, CAL, ["ABC"])["sess_to_results"]["ABC"] == CAP).all())


class IncrementalMergeTests(unittest.TestCase):
    def test_merge_keeps_stored_rows_and_adds_new_ones(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "ABC.json"
            old = {"bm_date": "16-Jan-2026", "bm_purpose": "Financial Results", "bm_timestamp": "08-Jan-2026 19:30:00"}
            target.write_text(json.dumps({"from": "18-10-2016", "rows": [old]}), encoding="utf-8")
            new = {"bm_date": "16-Apr-2026", "bm_purpose": "Financial Results", "bm_timestamp": "08-Apr-2026 19:30:00"}
            merged = merge(target, "board-meetings", [old, new], "01-03-2026", "30-06-2026")
            self.assertEqual(len(merged["rows"]), 2)
            self.assertEqual(merged["from"], "18-10-2016")


if __name__ == "__main__":
    unittest.main()
