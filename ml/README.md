# Pulse prediction research

The active engine is `ml/rank.py` (**pulse-rank-v2**): a cross-sectional study of
175 liquid NSE stocks over ten years of Upstox V3 daily candles. The original
`ml/pulse.py` (pulse-daily-v1, 12 BSE stocks, direction only) remains for
reference; its first frozen result is in `RESULTS.md`.

## Run on Windows (v2)

```powershell
npm run research:collect     # NSE universe + indices, 10 years, resumable
npm run research:train       # walk-forward selection, one holdout evaluation, report
npm run research:update      # daily: incremental candles, refit on matured labels, predict
npm run research:forward     # score write-once forward forecasts that have matured
npm run test:research        # Node + Python leakage/mechanics tests
```

### v2 protocol (fixed in code before results)

* Prediction after a completed session; entry next open; exit at the 5th/20th session close.
* 26 stock features (returns, 12-1 momentum, volatility, idiosyncratic volatility, beta,
  52-week high/low distance, moving-average distance, RSI, liquidity, Amihud illiquidity,
  volume trend, sector-relative returns) converted to same-date percentile ranks, plus
  8 market-regime features. All use bars at or before the signal date.
* Three objectives on identical rows: beat the same-date peer median (primary, balanced
  by construction), beat NIFTY 50 over the same window, positive absolute return.
* Candidates: four literature factors with fixed signs (12-1 momentum, 5-day reversal,
  low volatility, 52-week-high proximity), L2 logistic regression, histogram gradient
  boosting, and their ensemble.
* Earliest 80% of dates = development with four expanding purged walk-forward folds;
  selection by mean validation rank IC (amended from uncalibrated log loss after
  development results, before any holdout evaluation; recorded in the report).
* Sigmoid calibration on development out-of-fold predictions only.
* Final 20% holdout evaluated once: primary protocol refits every 63 sessions on matured
  labels only; a single frozen model is reported alongside.
* Reports accuracy with date-block bootstrap intervals, AUC, log loss, Brier, daily rank IC
  with non-overlapping t-statistics, quintile spreads, a top-20 portfolio with turnover
  costs averaged over all start offsets, accuracy-vs-coverage curves (the honest test of
  whether any confident subset reaches 90%), reliability tables and regime splits.
* Demerger-like discontinuities are listed explicitly in `CORPORATE_EVENTS`.
* `infer` refits the selected configuration on all matured labels and appends a
  write-once forecast to `data/pulse/forward/<model>/<date>.json`. Those forecasts are
  the only genuinely untouched test; `score-forward` evaluates them as they mature.

### Volatility risk (ml/risk.py, pulse-risk-v1)

Same panel and protocol; target is whether the next 20 sessions' realised volatility
exceeds the stock's trailing-year normal level. Candidates: persistence, logistic,
gradient boosting, ensemble; selection by development AUC; fixed tiers
(elevated >= 0.65, calm <= 0.35). Writes `reports/risk-latest.json`,
`risk-predictions.json` and its own write-once forward ledger. `npm run research:*`
commands run it after the ranking engine.

---

## v1 reference (pulse-daily-v1)

This local CPU pipeline trains genuine models on cached Upstox daily candles.
It does not use generated prices or turn Gemini prose into probabilities.

## Run on Windows

```powershell
python -m venv --system-site-packages .venv-pulse
.\.venv-pulse\Scripts\python.exe -m pip install -r ml/requirements.txt
.\.venv-pulse\Scripts\python.exe -m unittest ml.test_pulse -v
.\.venv-pulse\Scripts\python.exe -m ml.pulse train --data-dir data/pulse
.\.venv-pulse\Scripts\python.exe -m ml.pulse infer --data-dir data/pulse
```

The Node collector owns `data/pulse/candles/<SYMBOL>.json`. Each file must have
`symbol`, `instrumentKey`, `exchange`, `benchmark`, `source: "upstox-v3"`,
`fetchedAt`, and provider OHLCV candle arrays. A real benchmark defines expected
trading sessions. Missing stock sessions remain missing, not forward filled.

## Frozen experiment protocol

* Predict strictly positive next-session-open to 5/20-session-close returns.
* Seventeen end-of-day features use prices, volume and benchmark history only.
* Require 61 complete past sessions. Exclude feature windows following already
  observed large price discontinuities. **Retain future price jumps in labels
  and evaluation**: filtering them would remove crashes using hindsight.
  Independent corporate-action adjustment remains unverified, so raw-price
  labels may misrepresent economic returns around splits and dividends. The
  report counts affected rows; this prevents any claim of deployment readiness.
* Last 20% of eligible dates is the final holdout. Last 15% of development is
  sigmoid calibration. Labels crossing **every** split boundary are purged.
* Three chronological walk-forward folds on earlier training dates select among
  logistic regression and CatBoost depth 4/6 using validation log loss. Each
  CatBoost has 220 iterations, fixed seed, and at most four CPU threads.
* Fit the selected model once, calibrate only before the holdout, evaluate the
  final holdout once. Do not tune thresholds after looking at holdout outcomes.
* Report accuracy, AUC, Brier score, log loss, majority/momentum/logistic baselines,
  strong-signal coverage/precision, and 95% date-block accuracy intervals.
* Long-only equal-weight backtest enters at next open and uses non-overlapping
  cohorts, 60% threshold, 20 bps assumed round-trip costs, plus 10/40 bps sensitivity.
  Drawdown is measured at cohort exits, **not** daily mark-to-market; it may
  understate losses. Market impact, circuit limits and liquidity are unmodelled.

Historical Gemini output is excluded from backtests because a modern LLM may
remember eventual outcomes. The optional news features use deterministic counts
of literal observed earnings, capital, regulatory, business and correction events,
plus source diversity. Availability is the later of publication and actual first
observation. A supplied `availableAt` or archive flag cannot backdate a record;
later corrections cannot change an earlier prediction. After-close observations
wait until the next daily signal. News classification for current research can be
shown separately by the application.

News ablation stays `unavailable` until there are at least 450 mature sessions,
1,000 stock-date rows after observation started, and 100 rows with relevant news.
Once eligible, the pipeline compares both variants on identical rows and splits,
persists their artifacts and reports accuracy/log-loss differences without automatic
promotion. This is a sparse observed stream: absent events do not establish full
source coverage, and predictive attribution to reporters is not claimed.

## Artifacts and reproducibility

`data/pulse/models/<version>/` stores the fitted models, exact holdout predictions
and immutable report. The version includes canonical candle content, essential
instrument metadata, source code and protocol parameters;
changing only retrieval time does not create another experiment. Repeating train
on identical data republishes the recorded report without retuning. Model files
are local trusted joblib artifacts; never load third-party joblib files.

`reports/latest.json` and `predictions.json` are atomic UI-facing outputs. Existing
successful reports survive failures; `reports/last-error.json` records a failure.
Inference uses the exact evaluated artifact. It is intentionally **not** refitted
using the holdout; training/calibration dates are exposed beside predictions.

Current instrument selection introduces survivorship bias. Historical news
coverage, corporate-action adjustment and execution assumptions limit claims.
Missing future candles make labels unscorable and are counted; this remaining
selection effect must not be interpreted as a strategy filter available in advance.
Accuracy under 90% is an honest result, not a reason to reuse the holdout for
optimization. Tests use synthetic fixtures only to prove pipeline mechanics;
test fixture metrics are never published as model performance.
