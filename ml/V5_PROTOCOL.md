# pulse-risk-v5 study protocol (written 19 October 2026, before any v5 result)

This protocol is committed before any intraday or option-skew feature is computed
or evaluated. Results go into `ml/RESULTS.md`; nothing here changes after the
first run.

## Question

Do market-generated signals that v4 does not see improve the 20-session
volatility forecast (the same target as pulse-risk-v4)?

* **Intraday price action** from Upstox 1-minute candles (from January 2022).
* **Panic and dip behaviour**: how sharp a day's sell-off was, whether it
  recovered by the close, and how broad the selling was across the market.
* **The option surface beyond at-the-money**: skew, positioning and open
  interest, from the F&O bhavcopies already collected (from 2016).

## Inputs (all at session t use only data at or before t's close)

**Intraday, per stock and session** (`i_`). The session's 5-minute log returns
(09:15 to 15:30) are used; the overnight gap is excluded and stays in v4's
`gap20`.

* `i_rv1`, `i_rv5`, `i_rv22`: realised volatility (square root of summed squared
  5-minute returns), averaged over 1, 5 and 22 sessions (HAR structure, Corsi
  2009), each as a log ratio to the stock's normal 20-session volatility.
* `i_down_share5`: downside semivariance over total realised variance, 5-session
  mean (Patton and Sheppard 2015).
* `i_jump22`: share of realised variance from jumps, max(RV − bipower
  variation, 0) / RV, 22-session mean.
* `i_open_share5`: share of the session's realised variance in the first 30
  minutes, 5-session mean.
* `i_mdd1`: the session's largest peak-to-trough fall (log, 1-minute closes),
  over normal volatility.
* `i_rebound1`: log(close / session low), over normal volatility.
* `i_last30_volume5`: share of volume traded in the last 30 minutes, 5-session
  mean minus its 60-session mean.
* `i_vwap_gap1`: log(close / session VWAP).
* `i_has`: 1 when intraday inputs exist for the row.

**Panic and dip, market-wide** (`m_`, the same value for every stock on a date):

* `m_breadth_down1`, `m_breadth_down5`: share of universe stocks down more than
  2% on the day, and its 5-session mean (daily candles; full history).
* `m_panic1`: cross-sectional median of `i_mdd1`.
* `m_rebound1`: cross-sectional median of `i_rebound1`.
* `m_index_rv5`: NIFTY 50 5-minute realised volatility, 5-session mean, as a log
  ratio to its trailing 252-session median.
* `m_vix_range1`: India VIX intraday (high − low) / open from 1-minute candles.

**Option surface, per stock** (`s_`; F&O stocks only, 3-session carry like v4's
implied volatility):

* `s_put_skew`, `s_call_skew`: implied volatility at about 0.95 F and 1.05 F,
  minus at-the-money implied volatility, at the nearest expiry at least 7 days
  away (log-moneyness interpolation; nearest strike within 2.5% otherwise
  missing).
* `s_pcr_oi`: log(put open interest / call open interest), nearest two expiries.
* `s_oi_chg5`: log change in total option open interest over 5 sessions.
* `s_fut_buildup5`: log change in futures open interest over 5 sessions, signed by
  the stock's 5-session return (positive means long build-up or short covering,
  negative means short build-up or long unwinding).
* `s_has`: 1 when option-surface inputs exist.

## Arms

| Arm | Inputs |
|---|---|
| A | pulse-risk-v4 (baseline) |
| B | v4 + intraday + panic/dip (`i_`, `m_`) |
| C | v4 + option surface (`s_`) |
| D | v4 + all of the above (the full v5) |

Each arm is fitted as logistic and as the logistic/GBM ensemble, exactly as
`ml.risk.fit` does. Pre-2022 rows carry missing intraday inputs (`i_has` = 0),
imputed by the existing pipeline.

## Folds

Intraday data starts in January 2022, so v4's four development folds
(validation from August 2020) cannot test it. All arms use the same eight
quarterly validation folds inside the development period:

* Validation starts: 2023-01-02, 2023-04-03, 2023-07-03, 2023-10-03,
  2024-01-01, 2024-04-01, 2024-07-01, 2024-10-01. Each fold ends at the next
  start, and the last ends at the holdout start, 2024-12-04.
* Training uses every development row whose label ends before the fold start
  (full history from 2016, so v4 is not weakened).
* Validation rows must have labels ending before the fold end.

The holdout (2024-12-04 to 2026-09-17) is not used for any choice.

## Gate (fixed now)

An arm passes when, for the same model type, it improves mean fold AUC over arm A
by at least 0.005 **and** improves AUC in at least 6 of the 8 folds.

If one or more arms pass, only the arm and model with the highest mean fold AUC
is scored on the holdout, once, with the v4 protocol: refit every 63 sessions on
matured labels, sigmoid calibration fitted on development out-of-fold
predictions. v4 is re-scored on the same rows and calibration method for a
like-for-like comparison.

v5 replaces v4 as the live model only if, on the holdout, its AUC is at least
0.005 higher **and** its accuracy is not lower. Otherwise v4 stays. Either way the
outcome is written up in `ml/RESULTS.md`.

## Secondary (reported, not decisional)

* Accuracy, confident-half accuracy and top-20% precision for each arm on the
  folds.
* The same `i_`/`m_`/`s_` inputs, cross-sectionally ranked, in the 5-session
  ranking model (rank IC, same folds). This tests the dip-reversal idea for
  direction. It is a separate claim, which needs its own pre-registered study
  before anything ships.
* Holdout coverage of intraday inputs (expected near 100%).

## Known limits

* Training rows with intraday inputs cover only January 2022 onwards, about
  three years, so tree models see fewer examples of the new inputs than of v4's.
* Upstox 1-minute history is vendor data. Gaps are recorded in
  `reports/minute-collection.json` and left missing, never filled.
* Survivorship bias of the current large- and mid-cap universe applies as in v4.
