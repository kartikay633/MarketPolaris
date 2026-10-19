"""Synthetic fixtures validate mechanics and timing only; they are not evidence."""
import unittest

import numpy as np
import pandas as pd

from ml.crisis_study import (CASH_BUFFER, MAX_WEIGHT, PER_SECTOR, POLICIES, Row, build_plan, crisis_signal, episodes,
                             off_run, policy_arrays, replay, walk_calibrate, walk_forward)


def market(n=220, k=24, seed=3):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0, .02, (n, k)), axis=0))
    opens = close * np.exp(rng.normal(0, .005, (n, k)))
    opens[rng.random((n, k)) < .01] = np.nan          # occasional missing candles
    return pd.bdate_range("2020-01-01", periods=n), [f"S{j}" for j in range(k)], opens, close


def rows(n, symbols, seed=5):
    rng = np.random.default_rng(seed)
    out = {}
    for i in range(n):
        prob = rng.random(len(symbols))
        pct = pd.Series(prob).rank(pct=True).to_numpy()
        p = rng.random(len(symbols))
        out[i] = [Row(s, "A" if j % 3 == 0 else "B" if j % 3 == 1 else "C", float(prob[j]),
                      "top quintile" if pct[j] > .8 else "bottom quintile" if pct[j] <= .2 else "middle",
                      "elevated" if p[j] >= .65 else "calm" if p[j] <= .35 else "normal", .15 + .3 * p[j])
                  for j, s in enumerate(symbols)]
    return out


class CrisisTimingTests(unittest.TestCase):
    def test_signal_uses_only_past_and_current_closes(self):
        rng = np.random.default_rng(1)
        idx = pd.bdate_range("2017-01-02", periods=700)
        nifty = pd.Series(10000 * np.exp(np.cumsum(rng.normal(0, .012, 700))), index=idx)
        vix = pd.Series(15 * np.exp(np.cumsum(rng.normal(0, .05, 700))), index=idx)
        base = crisis_signal(nifty, vix)
        cut = idx[500]
        n2, v2 = nifty.copy(), vix.copy()
        n2[idx > cut] *= .5
        v2[idx > cut] *= 3
        after = crisis_signal(n2, v2)
        pd.testing.assert_frame_equal(base.loc[:cut], after.loc[:cut])
        # VIX threshold excludes the current session; drawdown uses the trailing 60 closes.
        t = 400
        self.assertAlmostEqual(base.vixThreshold.iloc[t], vix.iloc[t - 252:t].quantile(.95))
        self.assertAlmostEqual(base.drawdown60.iloc[t], nifty.iloc[t] / nifty.iloc[t - 59:t + 1].max() - 1)

    def test_episodes_merge_short_gaps_and_off_run_is_causal(self):
        on = np.zeros(60, dtype=bool)
        on[[5, 6, 15, 30]] = True       # 8 off sessions between 6 and 15 merge; 14 between 15 and 30 do not
        self.assertEqual([(s, e) for s, e, _ in episodes(on)], [(5, 15), (30, 30)])
        run = off_run(on)
        self.assertTrue(np.isinf(run[:5]).all())
        self.assertEqual(run[15], 0)
        self.assertEqual(run[25], 10)
        crisis = policy_arrays("d", on)["crisis"]
        self.assertTrue(crisis[30 + 20] and not crisis[30 + 21])

    def test_replay_decisions_never_use_later_data(self):
        dates, symbols, opens, closes = market()
        r = rows(len(dates), symbols)
        on = np.zeros(len(dates), dtype=bool)
        on[[60, 61, 62, 140]] = True
        k, start = 150, 10
        events = [("S3", 100)]
        for name in POLICIES:
            base = replay(dates, symbols, opens, closes, r, start, policy_arrays(name, on), events)
            o2, c2, on2 = opens.copy(), closes.copy(), on.copy()
            o2[k + 1:] *= 1.7
            c2[k + 1:] *= .4
            on2[k + 1:] = True
            r2 = rows(len(dates), symbols, seed=99)
            r2 = {i: (r[i] if i <= k else r2[i]) for i in r}
            changed = replay(dates, symbols, o2, c2, r2, start, policy_arrays(name, on2), events)
            np.testing.assert_array_equal(base["equity"][:k + 1 - start], changed["equity"][:k + 1 - start])
            key = lambda t: (t["decided"], t["side"], t["symbol"], t["quantity"], t["reason"])
            self.assertEqual([key(t) for t in base["trades"] if t["decided"] <= k],
                             [key(t) for t in changed["trades"] if t["decided"] <= k], name)
            self.assertEqual([t for t in base["trades"] if t["date"] <= k], [t for t in changed["trades"] if t["date"] <= k])

    def test_orders_fill_at_the_next_open(self):
        dates, symbols, opens, closes = market()
        out = replay(dates, symbols, opens, closes, rows(len(dates), symbols), 10, policy_arrays("b", np.zeros(len(dates), bool)))
        filled = [t for t in out["trades"] if t["status"] == "filled"]
        self.assertTrue(filled)
        for t in filled:
            self.assertEqual(t["date"], t["decided"] + 1)
            self.assertEqual(t["price"], opens[t["date"], symbols.index(t["symbol"])])
        self.assertEqual(out["equity"][0], 200000)

    def test_demerger_positions_exit_before_the_ex_date(self):
        dates, symbols, opens, closes = market()
        r = rows(len(dates), symbols)
        out = replay(dates, symbols, opens, closes, r, 10, policy_arrays("b", np.zeros(len(dates), bool)),
                     [(s, 120) for s in symbols])
        held_on_ex = [t for t in out["trades"] if t["status"] == "filled" and t["side"] == "BUY" and t["date"] == 119]
        self.assertFalse(held_on_ex)
        self.assertTrue(all(t["date"] == 119 for t in out["trades"] if t["reason"] == "demerger-exit"))

    def test_plan_respects_caps(self):
        _, symbols, _, closes = market()
        day = rows(1, symbols)[0]
        for cash in (CASH_BUFFER, 0.):
            plan = build_plan(200000, day, {s: closes[100, j] for j, s in enumerate(symbols)}, cash)
            self.assertLessEqual(len(plan), 10)
            self.assertTrue(all(h["amount"] <= MAX_WEIGHT * 200000 + 1e-6 for h in plan))
            self.assertLessEqual(sum(h["amount"] for h in plan), (1 - cash) * 200000 + 1e-6)
            sectors = pd.Series([next(x.sector for x in day if x.symbol == h["symbol"]) for h in plan]).value_counts()
            self.assertLessEqual(sectors.max(), PER_SECTOR)


class WalkForwardTests(unittest.TestCase):
    def frame(self):
        dates = pd.bdate_range("2019-01-01", periods=400)
        rng = np.random.default_rng(2)
        d = pd.DataFrame({"date": np.repeat(dates, 5), "x": rng.normal(size=2000)})
        d["labelEnd"] = d.date + pd.tseries.offsets.BDay(20)
        d["y"] = (d.x + rng.normal(size=2000) > 0).astype(int)
        return d, [dates[i] for i in range(150, 400, 63)]

    def test_models_train_only_on_labels_ended_before_each_refit(self):
        d, refits = self.frame()
        seen = []

        def fit(train):
            seen.append(train.labelEnd.max())
            return train.y.mean()
        raw, _ = walk_forward(d, refits, fit, lambda m, block: np.full(len(block), m))
        self.assertTrue(all(s < r for s, r in zip(seen, refits)))
        cal = walk_calibrate(d, raw.clip(.01, .99), refits)
        # Rewriting outcomes that were unknown at a refit cannot change that block.
        for r, nxt in zip(refits, refits[1:] + [None]):
            d2 = d.copy()
            d2.loc[d2.labelEnd >= r, "y"] = 1 - d2.loc[d2.labelEnd >= r, "y"]
            raw2, _ = walk_forward(d2, refits, fit, lambda m, block: np.full(len(block), m))
            cal2 = walk_calibrate(d2, raw2.clip(.01, .99), refits)
            block = (d.date >= r) & ((d.date < nxt) if nxt is not None else True)
            pd.testing.assert_series_equal(raw[block], raw2[block])
            pd.testing.assert_series_equal(cal[block], cal2[block])


if __name__ == "__main__":
    unittest.main()
