"""Synthetic fixtures validate mechanics only; these are not model evidence."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from ml.pulse import (FEATURES, backtest, block_accuracy_ci, load_candles,
                      make_dataset, make_features, purged_split, score)
from ml.pulse import build_model, positive_prob, experiment_identity
from ml.news_features import attach_news, news_ablation, NEWS_FEATURES


def fixture(n=240):
    dates = pd.bdate_range("2020-01-01", periods=n)
    close = 100 * np.exp(np.arange(n)*.0006 + np.sin(np.arange(n)*.15)*.015)
    return pd.DataFrame({"open": close*.999, "close": close, "high": close*1.01,
                         "low": close*.99, "volume": 10000 + np.arange(n)*11}, index=dates)


class LeakageTests(unittest.TestCase):
    def setUp(self):
        self.stock, self.benchmark = fixture(), fixture()
        self.frames = {"ABC": self.stock, "SENSEX": self.benchmark}
        self.meta = {"ABC": {"exchange": "BSE", "benchmark": False}, "SENSEX": {"benchmark": True}}

    def test_future_prices_do_not_change_past_features(self):
        original = make_features(self.stock, self.benchmark)
        modified, benchmark = self.stock.copy(), self.benchmark.copy()
        modified.iloc[150:, :4] *= 3
        benchmark.iloc[150:, :4] *= 5
        actual = make_features(modified, benchmark)
        pd.testing.assert_frame_equal(original.iloc[:150][FEATURES], actual.iloc[:150][FEATURES])

    def test_label_uses_next_open_and_fifth_session_close(self):
        dataset, _, _ = make_dataset(self.frames, self.meta, 5)
        row = dataset.iloc[20]
        i = self.stock.index.get_loc(row.date)
        expected = self.stock.close.iloc[i+5] / self.stock.open.iloc[i+1] - 1
        self.assertAlmostEqual(row.forwardReturn, expected)
        self.assertEqual(row.entryDate, self.stock.index[i+1])
        self.assertEqual(row.labelEnd, self.stock.index[i+5])

    def test_missing_session_cannot_shift_target_or_be_filled(self):
        missing = self.stock.index[150]
        self.frames["ABC"] = self.stock.drop(missing)
        dataset, _, exclusions = make_dataset(self.frames, self.meta, 5)
        self.assertFalse(dataset.date.isin(self.stock.index[145:151]).any())
        self.assertFalse(dataset.date.isin(self.stock.index[150:211]).any())
        self.assertEqual(exclusions["ABC"]["missingSessions"], 1)

    def test_future_jump_is_retained_and_past_jump_excludes_features(self):
        self.stock.loc[self.stock.index[150]:, ["open", "high", "low", "close"]] /= 2
        dataset, _, exclusions = make_dataset(self.frames, self.meta, 5)
        self.assertEqual(int(dataset.date.isin(self.stock.index[145:150]).sum()), 5)
        self.assertFalse(dataset.date.isin(self.stock.index[150:211]).any())
        self.assertEqual(dataset.futureDiscontinuity.sum(), 5)
        self.assertEqual(exclusions["ABC"]["discontinuities"], 1)

    def test_label_end_is_strictly_purged_at_split(self):
        dataset, _, _ = make_dataset(self.frames, self.meta, 20)
        start = self.stock.index[160]
        train, valid = purged_split(dataset, start)
        self.assertTrue((train.labelEnd < start).all())
        self.assertTrue((valid.date >= start).all())
        self.assertFalse((train.labelEnd == start).any())

    def test_validation_labels_cannot_reach_next_partition(self):
        dataset, _, _ = make_dataset(self.frames, self.meta, 20)
        _, valid = purged_split(dataset, self.stock.index[100], self.stock.index[180])
        self.assertTrue((valid.labelEnd < self.stock.index[180]).all())

    def test_insufficient_future_is_not_labelled_down(self):
        dataset, latest, _ = make_dataset(self.frames, self.meta, 20)
        self.assertEqual(dataset.date.max(), self.stock.index[-21])
        self.assertEqual(latest.date.max(), self.stock.index[-1])

    def test_benchmark_is_required(self):
        with self.assertRaisesRegex(ValueError, "benchmark"):
            make_dataset({"ABC": self.stock}, {"ABC": self.meta["ABC"]}, 5)

    def test_backtest_cohorts_do_not_overlap(self):
        dataset, _, _ = make_dataset(self.frames, self.meta, 5)
        result = backtest(dataset, np.repeat(.7, len(dataset)), 5)
        for prior, following in zip(result["cohorts"], result["cohorts"][1:]):
            self.assertGreater(following["entryDate"], prior["exitDate"])
        first = result["cohorts"][0]
        self.assertAlmostEqual(first["netReturn"], dataset.iloc[0].forwardReturn - .002)

    def test_no_signals_means_cash_not_fabricated_trades(self):
        dataset, _, _ = make_dataset(self.frames, self.meta, 5)
        result = backtest(dataset, np.repeat(.5, len(dataset)), 5)
        self.assertEqual(result["totalReturn"], 0)
        self.assertEqual(result["investedCohorts"], 0)

    def test_block_bootstrap_is_reproducible(self):
        dataset, _, _ = make_dataset(self.frames, self.meta, 5)
        p = np.repeat(.7, len(dataset))
        self.assertEqual(block_accuracy_ci(dataset, p, 5), block_accuracy_ci(dataset, p, 5))

    def test_saved_models_preserve_predictions(self):
        dataset, _, _ = make_dataset(self.frames, self.meta, 5)
        with tempfile.TemporaryDirectory() as tmp:
            for name in ["logistic", "catboost_4"]:
                model = build_model(name)
                model.fit(dataset[FEATURES], dataset.target)
                path = Path(tmp) / "model.joblib"
                joblib.dump(model, path)
                loaded = joblib.load(path)
                np.testing.assert_array_equal(positive_prob(model, dataset), positive_prob(loaded, dataset))


class NewsTests(unittest.TestCase):
    def setUp(self):
        self.rows = pd.DataFrame({"date": pd.to_datetime(["2020-01-02", "2020-01-03"]), "symbol": ["ABC", "ABC"]})
        self.event = {"id": "a", "sourceUrl": "https://www.bseindia.com/a", "sourceId": "bse",
                      "sourceType": "exchange-disclosure", "symbols": ["ABC"], "contentHash": "a",
                      "publishedAt": "2020-01-01T10:00:00+05:30", "firstSeenAt": "2020-01-02T16:00:00+05:30",
                      "provenance": "observed-import", "title": "Quarterly results", "excerpt": ""}

    def test_after_close_observation_waits_until_next_signal(self):
        news = attach_news(self.rows, [self.event])
        self.assertEqual(list(news.news_count7), [0, 1])

    def test_archive_flags_and_llm_output_cannot_backdate_news(self):
        event = {**self.event, "availableAt": "2019-01-01T00:00:00Z", "archiveVerified": True,
                 "classification": {"topic": "business-event", "method": "gemini"}}
        news = attach_news(self.rows, [event])
        self.assertEqual(list(news.news_count7), [0, 1])
        self.assertEqual(news.news_business7.sum(), 0)
        self.assertEqual(news.news_earnings7.sum(), 1)

    def test_future_correction_does_not_rewrite_old_features(self):
        correction = {**self.event, "id": "b", "contentHash": "b", "title": "Correction to quarterly results",
                      "firstSeenAt": "2020-01-04T12:00:00+05:30"}
        a = attach_news(self.rows, [self.event])
        b = attach_news(self.rows, [self.event, correction])
        pd.testing.assert_frame_equal(a, b)

    def test_naive_timestamps_are_ineligible(self):
        news = attach_news(self.rows, [{**self.event, "firstSeenAt": "2020-01-01T12:00:00"}])
        self.assertEqual(news[NEWS_FEATURES].sum().sum(), 0)

    def test_news_for_other_stock_is_not_used(self):
        news = attach_news(self.rows, [{**self.event, "symbols": ["OTHER"]}])
        self.assertEqual(news.news_count7.sum(), 0)

    def test_insufficient_news_never_runs_experiment(self):
        def forbidden(*args):
            raise AssertionError("Must not train insufficient news history")
        result = news_ablation(self.rows, [self.event], 5, Path("unused"), forbidden)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["eligibleSessions"], 1)


class SourceTests(unittest.TestCase):
    def test_experiment_identity_is_stable_and_depends_on_data(self):
        self.assertEqual(experiment_identity("a"), experiment_identity("a"))
        self.assertNotEqual(experiment_identity("a")[0], experiment_identity("b")[0])
    def test_conflicts_invalid_ohlc_and_duplicate_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "candles"
            root.mkdir()
            obj = {"symbol": "ABC", "source": "upstox-v3", "candles": [
                ["2020-01-01T00:00:00+05:30", 10, 11, 9, 10, 100, 0],
                ["2020-01-01T00:00:00+05:30", 10, 11, 9, 10, 100, 0],
                ["2020-01-02T00:00:00+05:30", 10, 11, 9, 10, 100, 0],
                ["2020-01-02T00:00:00+05:30", 10, 11, 9, 11, 100, 0],
                ["2020-01-03T00:00:00+05:30", 10, 8, 9, 10, 100, 0]]}
            (root / "ABC.json").write_text(json.dumps(obj))
            frames, _, quality, hash1 = load_candles(tmp)
            self.assertEqual(len(frames["ABC"]), 1)
            self.assertEqual(frames["ABC"].index[0], pd.Timestamp("2020-01-01"))
            self.assertEqual(quality["ABC"]["conflictingDatesExcluded"], 1)
            obj["fetchedAt"] = "different-retrieval-time"
            (root / "ABC.json").write_text(json.dumps(obj))
            self.assertEqual(hash1, load_candles(tmp)[3])

    def test_unknown_provider_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "candles"
            root.mkdir()
            (root / "ABC.json").write_text(json.dumps({"source": "synthetic", "symbol": "ABC", "candles": []}))
            with self.assertRaisesRegex(ValueError, "provenance"):
                load_candles(tmp)


if __name__ == "__main__":
    unittest.main()
