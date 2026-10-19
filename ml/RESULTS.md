# Pulse research results

## Qwen 2.5 3B disclosure tags as model inputs — 19 October 2026 (not adopted)

The local model labelled 100,093 NSE filings (74,472 unique texts) with event type,
tone and magnitude (`ml.news_tags`, about 16 hours on an RTX 3050). Event study by
label (`reports/news-study.json`):

* Tone does not predict direction. "Results, positive" rose on the first session
  47% of the time, the same as "results, neutral".
* Results and dividend labels mark the big moves (1.4–1.5σ versus 0.73σ), which the
  results calendar already captures.
* Two contrarian effects, abnormal 5-session drift from the next open:
  * negative legal/regulatory filings: +0.8% (t = 6.1, n = 1,104)
  * negative promoter stake/pledge filings: +1.0% (t = 4.5, n = 526)

  Overlapping events can inflate these t-statistics, so they are not trusted
  without a walk-forward test.

**Walk-forward test** (`ml.disclosure_features.tag_features`: counts of negative,
positive, major, legal-negative, promoter-negative, disruption-negative and major
results filings known by the 18:00 IST cutoff). The gates were fixed before
running: +0.005 in the mean metric and better in at least 3 of 4 folds.

| Model | Without tags | With tags | Folds better | Gate |
|---|---|---|---|---|
| Volatility v4, ensemble (AUC) | 0.6575 | 0.6586 | 2 of 4 | fail |
| Volatility v4, logistic (AUC) | 0.6546 | 0.6542 | 2 of 4 | fail |
| Ranking 5-session, ensemble (rank IC) | 0.0284 | 0.0264 | 1 of 4 | fail |
| Ranking 5-session, logistic (rank IC) | 0.0234 | 0.0236 | 2 of 4 | fail |

The tags add nothing the price, implied-volatility and results-calendar inputs do
not already carry. The holdout was not used. Both models are unchanged. The tags
remain available for customer-facing context, such as explaining a filing in chat
or alerting a holder to a major negative filing, where they are descriptions,
not forecasts.

## pulse-risk-v4 — volatility risk forecast with implied volatility, 18 October 2026 (current)

v3 inputs plus the four core implied-volatility inputs below (`o_lr_iv`,
`o_iv_vs_median`, `o_iv_minus_rv`, `o_has_iv`). Model version
`pulse-risk-v4-27135f4bb39b2ce6`; development selection chose the
logistic + gradient-boosting ensemble (mean AUC 0.6575; logistic 0.6546).

Holdout 2024-12-04 – 2026-09-17 (77,310 rows), refit every 63 sessions:
accuracy **71.1%** (95% block-bootstrap interval 66.0–76.3%), AUC **0.789**,
log loss 0.569. Most confident 50% of calls 81.9%, 20% 87.0%, 5% 89.5%,
1% 92.9%. Elevated tier (17.8% of rows) precision 84.5%; calm tier (37.1%)
79.2%. By year: 2025 73.7%, 2026 69.8%. Reproduces the one-time study below.

The daily pipeline now also runs `ml.fo_history collect --recent 10` (non-fatal;
implied volatility carries forward up to 3 sessions, then is imputed). The 16 Oct
model portfolios in the planner ledger were re-recorded with v4 sizing before
the forward test start (logged in `advisor/ledger-notes.txt`). The holdout has
now informed v1–v4, so the v4 forward ledger is the only untouched test.

## Stock implied volatility from NSE F&O bhavcopies — 18 October 2026 (research; shipped as pulse-risk-v4)

**Data.** NSE's public daily F&O bhavcopy archive (`python -m ml.fo_history collect`):
2,479 of 2,480 sessions, 18 Oct 2016 – 16 Oct 2026, legacy format to 5 Jul 2024 and
UDiFF after. There was no block. The archive has no file for 30 Mar 2021 in either
format (404), and that gap is recorded in `fo-history/status.json`. Stored are stock
futures and traded stock options, three nearest expiries (235 MB). Old tickers are
mapped through NSE's symbol-change list, only before each change's effective date.

**Feature** (`ml/option_features.py`, method `atm-iv-v1`): Black-76 ATM implied
volatility from that session's closing option prices and same-expiry future. The
call and put IVs are averaged per strike and interpolated to the forward. Expiries
under 7 days are skipped. Total variance is interpolated to 28 calendar days (~20
sessions). Inputs added to v3:

* IV / normal volatility (log)
* IV / its own trailing 252-session median (log)
* IV minus current 20-session realised volatility
* an IV-available flag

F&O stocks cover 71–91% of rows a year; the other stocks are imputed.

**Development** (same four walk-forward folds; the gate was fixed before running:
≥ +0.005 mean AUC and better in ≥ 3 of 4 folds):

| Inputs / model | Mean AUC | Fold AUCs | Accuracy (calibrated OOF) | Confident half |
|---|---|---|---|---|
| v3, logistic | 0.6463 | .607 / .666 / .673 / .639 | 64.9% | 73.1% |
| v3, ensemble | 0.6468 | .599 / .671 / .665 / .653 | 64.1% | 72.3% |
| v3 + IV, logistic | 0.6546 | .613 / .667 / .683 / .656 | 65.2% | 73.6% |
| **v3 + IV, ensemble** | **0.6575** | .606 / .676 / .676 / .672 | 64.6% | 72.8% |
| v3 + IV + level, change, term slope, IV/RV ratio, ensemble | 0.6574 | | 64.6% | 72.8% |

Gain +0.011 AUC, better in 4/4 folds (logistic +0.008, also 4/4). The extra IV
inputs added nothing.

**Holdout, scored once** (2024-12-04 – 2026-09-17, 77,310 rows, refit every 63 sessions;
v3 was re-run in the same code and matches its published figures):

| | Accuracy (95% CI) | AUC | Log loss | Top 50% / 20% / 5% / 1% | Elevated tier (share, precision) | Calm tier |
|---|---|---|---|---|---|---|
| v3 | 70.6% (65.5–76.0) | 0.784 | 0.577 | 81.2 / 85.7 / 87.5 / 91.5% | 16.0%, 85.3% | 36.5%, 78.8% |
| v3 + IV | **71.1%** (66.0–76.3) | **0.789** | 0.569 | 81.9 / 87.0 / 89.5 / 92.9% | 17.8%, 84.5% | 37.1%, 79.2% |

Implied volatility helps consistently but modestly: about +0.5 accuracy points
and +0.005 AUC on the holdout, with clearer gains among the most confident calls.
This holdout has now been used for v1, v2, v3 and this test, so these figures
are optimistic. Shipped as pulse-risk-v4 with the daily `ml.fo_history collect --recent`
step and a fresh forward ledger. Report: `reports/iv-study.json`
(development only: `iv-study-dev.json`).

## pulse-risk-v3 — volatility risk forecast with results calendar, 18 October 2026 (superseded by v4)

v2 inputs plus the NSE results calendar (`ml/disclosure_features.py`). Model
version `pulse-risk-v3-306da6f4f604257e`. Development selection (highest mean
AUC) chose the logistic + gradient-boosting ensemble (0.6468) over logistic
(0.6463).

Holdout 2024-12-04 – 2026-09-17 (77,310 rows), refit every 63 sessions:
accuracy **70.6%** (95% block-bootstrap interval 65.5–76.0%), AUC **0.784**
(v2 70.3% / 0.768; v1 64.6% / 0.749). Most confident 50% of calls 81.2%, 20%
85.7%, 1% 91.5%. Elevated tier (16.0% of rows) precision 85.3%; calm tier
(36.5%) 78.8%. By year: 2025 73.1%, 2026 69.4%.

The holdout has now been used for v1, v2 and v3, so these figures are
optimistic; the v3 forward ledger is the untouched test. The daily pipeline
refreshes board-meeting intimations (`ml.news_history collect --recent 60
--only board-meetings`, looking 90 days ahead because NSE filters by meeting
date); if that step fails, upcoming results dates are missing for the day.

## News and local LLM research — 18 October 2026

**Data.** 196,856 NSE corporate announcements and 11,454 board-meeting records
for the 175-stock universe, Oct 2016 – Oct 2026, from NSE's public corporate
listings (`python -m ml.news_history collect`). Every row keeps NSE's
dissemination timestamp, so history is point-in-time. BSE's API refused
automated access and was not used.

**Event study** (`python -m ml.news_study run`, report `reports/news-study.json`;
moves are abnormal versus NIFTY 50, 195,028 filings scored):

* Results filings are the volatility events: first-session moves average 1.6σ
  versus 0.73σ on ordinary sessions, and 28% exceed 2σ (5.4% normally). Their
  direction is a coin flip.
* Clear directional effects are rare events: open offers +5.3% over 5 sessions
  (n=64), auditor resignations −4.0% over 20 (n=22), raids/fraud −3.2% (n=105),
  rating downgrades −3.0% (n=30), stake/block sales −0.9% on the day (n=173).
* Key-person deaths (67 directors; 17 promoters, founders or chairmen): −0.25%
  on the day for directors and a slightly positive median for promoters; no
  reliable pattern for these large, professionally run companies.

**Text models** (train before Jul 2023, test Jul 2024 – Sep 2026, 53,134 filings):

| Model | Big first-day move AUC | 5-session direction AUC | Direction accuracy |
|---|---|---|---|
| NSE category only | 0.594 | 0.510 | 51.9% |
| TF-IDF + logistic | 0.656 | 0.511 | 51.2% |
| Qwen 2.5 0.5B, LoRA fine-tuned (32 min, RTX 3050) | 0.604 | 0.511 | 50.9% |
| Majority class | — | — | 52.0% |

Disclosure text helps anticipate *large moves* but not *direction* once the
filing is public; the fine-tuned LLM did not beat the simple text baseline.

**Results calendar** (`ml/disclosure_features.py`): sessions to the next results
board meeting, counted only after NSE disseminated the intimation (18:00 IST
cutoff). Stocks with results due within 20 sessions turned volatile 58.6% of the
time versus 47.8%. Added to the v2 volatility inputs: development AUC 0.637 →
0.646; one-time holdout accuracy 70.3% → 70.7%, AUC 0.768 → 0.782, most
confident half 79.6% → 81.1%, most confident 20% 83.8% → 86.0%. Filing-flow
counts added nothing further. Shipped as pulse-risk-v3.

Local LLM setup: Ollama 0.40 with `qwen2.5:3b` (models on D:), tagging
disclosures with event type, tone and magnitude (`python -m ml.news_tags tag`,
resumable); LoRA environment on D:/MarketPulseML (`ml/news_finetune.py`).

## pulse-risk-v2 — volatility risk forecast, 18 October 2026 (superseded by v3)

Same target, split, candidates, calibration and refit protocol as v1; only the
inputs changed. Model version `pulse-risk-v2-8bbbbbaa46a91e55`, selected model
logistic regression (highest development AUC).

**Development walk-forward (used for every decision, four folds):**

| Inputs / model | Mean AUC | Accuracy | Confident half |
|---|---|---|---|
| v1 inputs, logistic | 0.594 | 59.7% | 64.3% |
| + range-based and multi-horizon volatility, seasonality, persistence | 0.617 | 61.6% | 68.5% |
| + India VIX | 0.632 | 64.5% | 72.2% |
| final (market-breadth inputs removed) | 0.637 | 64.5% | 72.5% |

Ablations: removing India VIX costs about 1 point of accuracy and 0.016 AUC;
removing range estimators about 0.5 points and 0.018 AUC; seasonality and calendar
inputs add little. Gradient boosting, XGBoost, CatBoost, pairwise interactions and
a logistic/XGBoost blend did not beat plain logistic regression across folds.

**Holdout 2024-12-04 – 2026-09-17 (77,310 rows), refit every 63 sessions:**
accuracy **70.3%** (95% block-bootstrap interval 64.9–75.6%), AUC **0.768**
(v1 on the same rows: 64.6%, AUC 0.749; persistence rule 63.3%). Most confident
50% of calls: 79.6%; 20%: 83.8%. Elevated tier (13.7% of rows) precision 84.8%;
calm tier (29.3%) precision 78.5%. By year: 2025 72.4%, 2026 69.6%.

These holdout figures are optimistic: v2 was built after the v1 holdout was
reported and the finalist was scored once on the same period. The v2 forward
ledger is the only untouched test.

**Direction (pulse-rank-v2, not changed):** the same search on the 5-session
peer target (return seasonality, residual and sector-relative reversal,
risk-adjusted momentum, volume-shock interaction, XGBoost and pairwise ranking)
raised development rank IC from 0.023 to 0.030 but accuracy only from 50.8% to
50.9%. That does not justify a new version and restarting its forward ledger.

## pulse-risk-v1 — volatility risk forecast, 15 October 2026 (superseded by v2)

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
