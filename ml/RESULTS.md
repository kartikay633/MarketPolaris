# Pulse research results

## pulse-risk-v1 — volatility risk forecast, 15 October 2026 (current)

Artifact `pulse-risk-v1-391ff940541b4c77`. Same 175-stock panel, features, event
exclusions, 80/20 split, purged walk-forward folds and 63-session refits as
pulse-rank-v2. Question: will realised volatility of daily returns over the next 20
sessions exceed the stock's own normal level (median 20-session volatility over the
trailing 252 sessions, known at prediction time)? Selection by mean development AUC.

| | Development (walk-forward) | Unseen holdout (29 Nov 2024 – 11 Sep 2026, 444 sessions, 77,313 rows) |
|---|---:|---:|
| Selected model | logistic regression (AUC 0.594) | — |
| Accuracy | 59.7% | **64.9%** (95% CI 58.0–71.5) |
| ROC AUC | 0.594 | **0.749** |
| Always-majority / persistence rule | — | 51.5% / 63.3% |
| Most confident 1% / 2% / 5% | 82.6% / 79.1% / 74.2% | **92.4% / 90.7% / 89.7%** |
| "Elevated" tier (p ≥ 0.65) precision | 65.6% (4.8% of rows) | **89.7%** (4.3% of rows) |
| "Calm" tier (p ≤ 0.35) precision | 70.6% | 78.9% |
| Later volatility vs normal: elevated / calm / all | 1.13× / 0.85× / 0.97× | 1.39× / 0.78× / 0.99× |

**This is where 90% is genuinely reached** — for the most confident few percent of
*risk* forecasts on unseen data, not for price direction. Treat ~80–90% as the honest
range for the confident subset: development folds (which include the 2020 shock and
regime shifts in "normal" volatility) were weaker than the holdout. Overall accuracy
beats a simple persistence rule by only 1.6 points; the value is in AUC and the
confident tiers. Calibration is conservative: extreme buckets were more extreme in
reality (predicted 65.7% → observed 85.1%; 28.2% → 16.1%). Accuracy varied by year
(2025 69.5%, 2026 59.4%) and was lower when NIFTY traded below its 200-day average
(56.1% vs 73.3%). A frozen end-of-development model scored 65.3% / AUC 0.757.

Disclosure: an exploratory probe of a similar volatility target was run on the same
holdout dates minutes before this protocol was written (it reported 66.6% accuracy, AUC
0.726 with gradient boosting). The protocol was not tuned to that probe — the selected
model and thresholds came from development data — but the forward ledger is the clean test.

Volatility forecasts say how much a stock may swing, never which way.

---

## pulse-rank-v2 — 15 October 2026 (current)

Artifact `pulse-rank-v2-fd03e214909413fe` (local, ignored `data/pulse/models/`).
Data: Upstox V3 NSE daily candles, 14 Oct 2016 – 13 Oct 2026, **175 stocks** in 13
sectors plus NIFTY 50, Next 50, Midcap 100 and 10 sector indices. About 376,000
labelled stock-sessions at 5 sessions (2,222 dates). LTIM did not resolve to a current
symbol; NIFTY_AUTO was dropped (provider returned a duplicated session).

Holdout: 19 Dec 2024 – 6 Oct 2026 (445 signal sessions, 77,503 stock-sessions at 5
sessions; 437 sessions at 20). Models refitted every 63 sessions on matured labels.

| Objective | Horizon | Selected | Accuracy (95% CI) | No-skill | Mean rank IC (95% CI) | Evidence |
|---|---:|---|---|---:|---|---|
| Beat peer median | 5 | ensemble (logistic + GBM) | **51.5%** (50.6–52.3) | 50.0% | **+0.041** (+0.014 to +0.066), t=2.7 | positive |
| Beat NIFTY 50 | 5 | ensemble | **52.2%** (50.2–53.9) | 51.6% | +0.042 (+0.012 to +0.068), t=3.0 | positive |
| Positive return | 5 | 5-day reversal | 47.7% (44.1–51.5) | 47.7% | −0.018 | none |
| Beat peer median | 20 | 12-1 momentum | 51.3% (49.1–53.5) | 50.0% | +0.025 (−0.030 to +0.081) | inconclusive |
| Beat NIFTY 50 | 20 | 12-1 momentum | 50.0% | 50.8% | +0.025 | inconclusive |
| Positive return | 20 | 12-1 momentum | 48.8% | 48.8% | −0.025 | none |

**The 90% question.** No objective approaches 90%. Keeping only the most confident 1%
of 5-session peer predictions gave 58.3% on the holdout (775 rows) but only 52.4% in
development, so that subset is not a dependable high-accuracy signal. The largest
reproducible gain is from ranking, not from confident individual calls. Absolute
direction (what most "90% accurate" claims refer to) showed no skill at all.

**Is the 5-session edge economically useful?** Marginally. Top quintile minus bottom
quintile: +0.30% per 5 sessions before costs; IC positive on 62.5% of days. An
equal-weight top-20 portfolio rebalanced every 5 sessions beat the equal-weight universe
by +1.7%/yr after 20 bps round-trip costs (−2.8% to +6.9% depending on start day),
+8.9%/yr at zero cost and −5.0%/yr at 40 bps. Turnover dominates: the signal is real
but thin, and execution costs decide whether it pays. Drawdown at rebalances: −14.6%.

**Robustness.** IC +0.046 in 2025 and +0.040 in 2026; +0.051 with NIFTY above its
200-day average and +0.032 below. A single model frozen at the end of development scored
IC +0.041, so refitting did not drive the result. Calibration is close: predicted
48.5–51.2% buckets map to observed 46.6–53.1%, i.e. probabilities are honest but
deliberately near 50%.

**Methods that did not help.** Low volatility (IC −0.003) and 52-week-high proximity
(+0.005) failed in development. GBM alone ranked better than logistic regression but
was over-confident before calibration. Twenty-session predictions did not generalise.

**Protocol deviation (disclosed).** Model selection was changed from uncalibrated log
loss to rank IC after seeing development folds and before any holdout evaluation:
log loss was penalising the best-ranking but over-confident models that the separate
calibration step corrects. The holdout dates overlap the period whose absolute-direction
results v1 published; the v2 universe, objectives and features were not evaluated there
before. The write-once forward ledger (`data/pulse/forward/`) is the untouched test.

**News.** Not tested: 30 records were observed from 13 Oct 2026, so no labelled session
can use them without hindsight. See `docs/pulse-news-sources.md`.

**Main limitations.** Survivorship bias (today's liquid universe), price returns exclude
dividends, five demerger discontinuities excluded by an explicit list, next-open fills
assumed, overlapping labels handled with block bootstrap and non-overlapping t-stats.

---

## pulse-daily-v1 — 14 October 2026 (superseded)

Run: 14 October 2026 IST. Artifact: `pulse-daily-v1-0d68de7c59e80aba`.
Source: actual cached Upstox V3 daily candles, 1,240 valid rows for each of 12
stocks and two benchmarks. No synthetic prices or LLM probabilities were used.
The report and exact holdout rows are stored under the ignored local
`data/pulse/models/<version>/` folder; the UI reads `reports/latest.json`.

| Metric | 5 sessions | 20 sessions |
|---|---:|---:|
| Selected by development walk-forward log loss | CatBoost depth 4 | Logistic regression |
| Holdout stock-date observations | 2,820 | 2,784 |
| Holdout sessions | 235 | 232 |
| Direction accuracy | 44.57% | 45.08% |
| 95% date-block accuracy interval | 38.65–50.58% | 36.26–53.07% |
| ROC AUC | 0.4895 | 0.4695 |
| Log loss | 0.6987 | 0.7258 |
| Training-majority accuracy | 44.57% | 44.11% |
| Training-majority log loss | 0.7010 | 0.7123 |
| Strong-signal coverage (up ≥60%, down ≤40%) | 0.00% | 20.98% |
| Strong up-signal precision | No signals | 39.83% (580 signals) |
| Strong down-signal precision | No signals | 75% (**only 4 signals**) |
| Long-only cohort net return, 20 bps round-trip costs | 0% (cash throughout) | −6.57% |
| Equal-universe cohort comparison | −23.56% | −15.08% |

The majority baseline learns its direction/probability from training data rather
than choosing whichever class dominated the test period. The five-session model
predicted up at the 50% threshold throughout this holdout. Four strong down signals
in the longer horizon are far too few to claim useful predictive precision.

**No reliable predictive edge was demonstrated, and 90% accuracy was not achieved.**
The five-session cash result is not evidence of trading skill. Both AUCs are below
0.5; the longer horizon's probability quality is worse than the training-majority
baseline despite a small accuracy increase. Do not invert signals after observing
these results and present that as an unseen evaluation.

Three fixed candidates were compared on three purged chronological development
folds per horizon. Sigmoid calibration used only the subsequent development
partition. Neither hyperparameters nor thresholds were changed after opening the
final holdout. The exact evaluated models are persisted, rather than refitted on
the holdout and relabelled as independently tested.

## Data and news limits

Corporate-action adjustment is not independently verified. Past large jumps
invalidate a following 61-session feature window, which can be known at signal
time. Future jumps are **retained** as labels and diagnostics, preventing ex-post
removal of crashes. Zero holdout rows in this run carried the large-jump flag;
smaller corporate actions can still affect economic return validity. Missing
future observations make a label unscorable and remain a reported selection risk.

The universe uses currently selected instruments and therefore has survivorship
bias. The simulated strategy ignores intraday mark-to-market drawdown, liquidity,
circuits, spread and market impact beyond the explicit assumed costs. Returns
are cohort-exit research estimates and do not qualify the model for deployment.

The observed news store contained 30 records first seen on 13 October 2026 at
17:16:33 UTC. **Zero historical labelled sessions were eligible** under the later
of publication and observation rule. A news-aware comparison is unavailable;
neither predictive news improvement nor source/reporter reliability was invented.
The guarded ablation workflow will require sufficient mature observed evidence
and compare both variants on the same dates and stock rows.

Any subsequent experiment must be selected using development evidence and retain
this report. A repeatedly inspected holdout is no longer independent; convincing
confirmation requires a genuinely untouched period or future forward testing.
