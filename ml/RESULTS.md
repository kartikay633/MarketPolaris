# Pulse research results

## How fast prices absorb NSE filings (minute level) — 19 October 2026 (research)

`python -m ml.filing_reaction run`. This measured 110,551 filings for our stocks, January 2022 to
16 October 2026, from NSE's dissemination second, against NIFTY 50 over the same minutes. It is
descriptive research and changes no model.

* **Results move prices a lot, but not instantly.** During market hours, a "Financial Result
  Updates" filing moves the stock 185 bps (absolute, abnormal) by the close. About 26% of that move
  happens within 5 minutes, 53% within 15 and 85% within 60. "Outcome of Board Meeting" filings
  show the same shape (162 bps; 29%, 57% and 87%). Results filed after hours gap 2.1% at the next
  open and move 3.1% by that close.
* **The first move does not predict the rest.** After the first 5, 15 or 30 minutes, the return to
  the close shows no continuation in the direction of the initial move, across all filings and
  every large category:
  * market hours, all filings: +0.2 bps after 5 minutes (t 0.3);
  * market-hours results: +4.6 bps (t 0.5);
  * after-hours results: −11 bps (t −1.4).

  Reacting to the headline a few minutes after NSE publishes it, in the direction the price first
  moved, has no edge even before trading costs (about 10 bps each way).
* **Possible exceptions, not established.** About 60 groups were tested, so one or two |t| ≈ 2
  results are expected by chance:
  * order wins filed after hours continued after the first 5 minutes of the next open
    (+31 bps, t 2.0, n = 100);
  * CEO/MD/CFO resignations during market hours kept falling after 30 minutes (−54 bps, t −2.0,
    n = 24).

  Each needs its own pre-registered test on later data before it means anything.
* **What it means for the filing reader.** About half of a results-day move happens after the first
  15 minutes, but its direction is not visible in the price at that point. If any part of it is
  predictable, it has to come from what the filing says. That is the question for stage 2 of
  `ml/FILING_READER_PROTOCOL.md`.

## v5 candidate: intraday prices, panic/dip breadth and the option surface — 19 October 2026 (not adopted)

Protocol committed before any result: `ml/V5_PROTOCOL.md` (d3322b5). Code: `ml/minute_history.py`,
`ml/v5_features.py` (no-lookahead tests in `ml/test_v5_features.py`), `ml/v5_intraday_study.py`.

**Data.**

* Upstox 1-minute candles, January 2022 to 16 October 2026: 189 instruments and 10,687 monthly files,
  stored outside the repository under `D:/MarketPulseML/minute`.
* The download ran at under 2,000 requests per 30 minutes. Two months failed on network errors, and
  both succeeded on retry.
* Intraday inputs cover 99–100% of rows from 2022 and none before. Holdout coverage is 99.8%.
* The option surface (put and call skew, put/call open interest, open-interest change and futures
  build-up) comes from the stored F&O bhavcopies, 2016–2026. It covers 71–85% of rows a year.

**Development folds.** There are 8 quarterly folds, January 2023 to the holdout start, trained on
all earlier development rows. The gate was fixed in advance: +0.005 mean AUC and better in at
least 6 of 8 folds.

| Arm | Model | Mean AUC | Gain vs v4 | Folds better | Gate | Calibrated accuracy | Top-20% accuracy |
|---|---|---|---|---|---|---|---|
| A v4 | logistic | 0.6427 | | | | 68.8% | 85.7% |
| A v4 | ensemble | 0.6446 | | | | 68.1% | 84.3% |
| B + intraday + panic | logistic | 0.6436 | +0.0009 | 5/8 | fail | 68.4% | 84.7% |
| B + intraday + panic | ensemble | 0.6495 | +0.0049 | 5/8 | fail | 67.5% | 84.1% |
| C + option surface | logistic | 0.6448 | +0.0020 | 6/8 | fail | 68.7% | 86.0% |
| C + option surface | ensemble | 0.6484 | +0.0037 | 6/8 | fail | 68.0% | 84.3% |
| D + all | logistic | 0.6453 | +0.0026 | 5/8 | fail | 68.4% | 84.7% |
| D + all | ensemble | 0.6529 | +0.0083 | 5/8 | fail | 67.4% | 83.9% |

No arm passed, so the holdout was not used and pulse-risk-v4 stays live.

**Why the gains are not real:**

* The largest mean gain (D, ensemble, +0.008) comes mostly from one quarter, 2024 Q1 (+0.05 AUC).
  It is worse in three of eight quarters, by up to −0.027 in 2024 Q3.
* The same arm lowers calibrated accuracy (68.1% to 67.4%) and top-20% accuracy (84.3% to 83.9%).
  Those are the numbers customers would see.
* The option surface is the most consistent (6 of 8 quarters for both models) but too small:
  +0.002 to +0.004.
* Minute-level volatility, downside semivariance, jumps, the intraday sell-off and recovery, market
  breadth and the India VIX range are all measured from the same price path as v4's daily range
  estimators and implied volatility. They add detail, but little information the 20-session
  forecast lacks.
* Intraday training rows start in January 2022, so the tree models see about one to three years of
  them. A later re-test with more history is reasonable, under the same protocol and a new
  pre-registration.

## v5 candidate: reported quarterly results (revenue, profit, EPS) — 19 October 2026 (not adopted)

**Data** (`python -m ml.results_history collect`, then `parse`): NSE's
financial-results listing (quarters to December 2024, XBRL from mid-2018) and its
integrated-filing listing (from the March 2025 quarter). The collector downloaded
5,135 XBRL filings for 175 stocks, one request every 1.5 seconds. NSE never blocked
it. 28 filings return 404 on NSE's archive and are recorded as missing.

* One basis per stock (consolidated wherever it covers most quarters: 4,816 of the
  5,096 parsed quarters) and the earliest filing per quarter, never a later revision.
* Parsed figures: revenue (banks: interest earned; insurers: gross premium),
  profit attributable to owners, and basic EPS. Values come from the filing's own
  undimensioned quarter context. 39 filings whose stated period is not the listed
  quarter (half-years, mislabelled rows) are rejected.
* Gaps: insurers are only in the integrated listing (5–7 quarters each). MCX has no
  XBRL quarters, and nothing exists before the March 2018 quarter.

**Timing** (`ml/results_features.py`; leakage tests in
`ml/test_results_features.py`). A quarter's numbers count from the first 18:00 IST
cutoff at or after the earlier of two times:

* NSE's dissemination of the XBRL filing;
* the first NSE announcement mentioning results on the board-meeting date or up to
  three days after it. The meeting date is the one the filing states, or for older
  filings the first results meeting in NSE's board-meeting history within 75 days
  of quarter end. If the announcement names a period, it must be this quarter.

The announcement sets the time for 92% of quarters (median 34 days after quarter
end). Older XBRL filings were sometimes disseminated months late. One unrelated
"Outcome of Board Meeting" match (VEDL, Sep-2020 quarter, a month early) was caught
before any evaluation, and the period check was added to rule out matches like it.

**Inputs:**

* year-on-year growth of revenue (log), net profit and EPS
* standardised unexpected profit: this quarter's year-on-year profit change minus
  the previous four quarters' mean change, over the standard deviation of the
  previous eight changes (a surprise proxy without analyst estimates)
* revenue acceleration, net-margin change, a loss flag
* sessions since results, a surprise weighted by freshness, an availability flag

Year-on-year and trend comparisons use only quarters already known at the time.
Results older than 200 days are treated as missing. Volatility gets the raw values;
ranking gets their same-date cross-sectional ranks.

**Development folds** (`python -m ml.results_study`). The gate was fixed before
running: +0.005 mean metric and better in at least 3 of 4 folds. Results inputs
cover 94–97% of validation rows in every fold, but only 52–77% of training rows,
because the XBRL history starts in 2018.

| Model | Without results | With results | Folds better | Gate | XBRL-time diagnostic |
|---|---|---|---|---|---|
| Volatility v4, ensemble (AUC) | 0.6575 | 0.6559 | 1 of 4 | fail | 0.6540 (0/4) |
| Volatility v4, logistic (AUC) | 0.6546 | 0.6539 | 1 of 4 | fail | 0.6511 (1/4) |
| Ranking 5-session, ensemble (rank IC) | 0.0284 | 0.0226 | 1 of 4 | fail | 0.0215 (1/4) |
| Ranking 5-session, logistic (rank IC) | 0.0234 | 0.0204 | 1 of 4 | fail | 0.0196 (1/4) |
| Ranking 20-session, ensemble (rank IC) | 0.0271 | 0.0309 | 2 of 4 | fail | 0.0391 (3/4, would pass) |
| Ranking 20-session, logistic (rank IC) | 0.0314 | 0.0269 | 2 of 4 | fail | 0.0271 (1/4) |

No configuration passed, so the holdout was not used and both models are
unchanged. The last column repeats the study with XBRL dissemination time only
(`--timing xbrl`). That check was declared non-decisional before either run.

Under the later XBRL timing, the 20-session ranking ensemble would pass (+0.012,
3 of 4 folds). That doesn't make it a candidate:

* It is 1 configuration out of 12, and it is the noisiest baseline (fold IC
  0.009–0.056).
* Timing is the only change. If later timing helps where the accurate timing
  does not, that points to fold noise, or to stepping past the short-term reversal
  described below. It is not evidence of drift.
* The same configuration passed the delivery study's development gate and then
  failed its holdout.

**Why it failed.** A descriptive check on development dates only, not used for the
decision: stocks whose results came out in the previous three sessions, ranked by
surprise or growth against their later return versus the universe median.

* Profit surprise: mean daily IC −0.025 (t −1.6) over 5 sessions and −0.024 (t −1.5)
  over 20.
* Year-on-year profit growth: −0.012 and −0.002.
* Revenue growth: −0.044 (t −3.0) and −0.002.

There is no post-earnings drift in this universe of liquid large and mid caps. If
anything, the stocks with the strongest growth give back a little of their jump
from results day over the following week. The results-day move itself is already
in the price-based inputs. The published Indian PEAD evidence comes mostly from
broader samples with smaller, less-covered companies; the 175 here are heavily
covered by analysts. For volatility, the results calendar (v3) already captures what
matters, namely that results are coming. The size of the surprise adds nothing to
that.

The collector (`collect --refresh` adds new quarters) is not in the nightly job.

## v5 candidate: NSE delivery and bulk/block deals — 19 October 2026 (not adopted)

**Data** (`python -m ml.flow_history collect`): all 2,480 sessions from 18 Oct 2016
to 16 Oct 2026 and 121 months of deals. Nothing failed and NSE never blocked the
collector (77 MB).

* Delivery (traded quantity, delivered quantity, delivery %): NSE's security-wise
  full bhavcopy from late 2019, and before that NSE's MTO delivery-position file,
  which holds the same figures. On an overlap day the two agree exactly on traded
  quantity and on 99.9% of delivered quantities. NSE served 8 Aug 2022's full
  bhavcopy as an Excel workbook, so that day comes from the MTO file.
* Bulk and block deals: the CSV download of NSE's bulk/block-deal report, one month
  per request. The JSON view of the same report stops at 70 rows, and the older
  `api/historical/bulk-deals` path answers 503, so neither is used.
* In the universe: 130–440 bulk-deal and 5–1,770 block-deal records a year. 7.8% of
  stock-sessions have a deal in the previous 20 sessions.

**Inputs** (`ml/flow_features.py`; leakage tests in `ml/test_flow_features.py`).
Figures for session t count from t's close, like the closing price. Deals dated on
non-trading days count from the next session.

* delivery share, its 5-session mean, and each versus the stock's own previous
  20- and 60-session median
* abnormal delivered quantity (1 and 5 sessions)
* bulk and block deal counts over 20 sessions
* deal buy minus sell quantity, and buy plus sell quantity, as a share of
  20-session volume
* any deal in the last 5 sessions

Volatility gets the raw values. Ranking gets their same-date cross-sectional ranks.

**Development folds** (`python -m ml.flow_study dev`). The gate was fixed before
running: +0.005 mean metric and better in at least 3 of 4 folds. Delivery covers
99.3–99.9% of rows in every fold and deals cover 100%, so there was no coverage
confound.

| Model | Without flow | With flow | Folds better | Gate |
|---|---|---|---|---|
| Volatility v4, ensemble (AUC) | 0.6575 | 0.6585 | 3 of 4 | fail (+0.001) |
| Volatility v4, logistic (AUC) | 0.6546 | 0.6587 | 3 of 4 | fail (+0.004) |
| Ranking 5-session, ensemble (rank IC) | 0.0284 | 0.0327 | 2 of 4 | fail |
| Ranking 5-session, logistic (rank IC) | 0.0234 | 0.0298 | 2 of 4 | fail |
| Ranking 20-session, ensemble (rank IC) | 0.0271 | 0.0338 | 4 of 4 | **pass** (+0.0067) |
| Ranking 20-session, logistic (rank IC) | 0.0314 | 0.0362 | 2 of 4 | fail |

**Holdout, scored once, for the passing configuration only** (`python -m ml.flow_study
holdout`, 438 sessions, refit every 63 sessions):

| 20-session ranking, ensemble | Mean rank IC (95% CI) | IC > 0 | Accuracy |
|---|---|---|---|
| v2 | −0.004 (−0.047 to +0.042) | 47.5% | 49.4% |
| v2 + flow | −0.008 (−0.047 to +0.032) | 46.6% | 49.5% |

The development gain did not hold up on the holdout. One pass out of eight tested
configurations is about what chance alone would produce. Twenty-session ranking also
had no holdout skill in pulse-rank-v2 (the shipped momentum rule scored +0.025,
inconclusive). Both models are unchanged.

Flow does carry some information. Every development comparison moved up, and the
volatility logistic gain was +0.004 in 3 of 4 folds. But that information mostly
overlaps with the volume, turnover and implied-volatility inputs the models already
have. The collector supports `--recent N` for daily updates. It is not in the
nightly job.

## v5 candidate: global markets, oil and the rupee — 19 October 2026 (not adopted)

**Data.** Upstox GLOBAL_INDEX and GLOBAL_INDICATOR daily candles from April 2020
(`scripts/pulse-global.js`):

* markets: S&P 500, Nasdaq-100, Dow, Dow futures, GIFT NIFTY, Nikkei, Hang Seng,
  DAX, FTSE
* commodities and currency: Brent, WTI, USD/INR

The provider's global candle dates are inconsistent (skipped sessions, weekend
rows), so a value counts for NSE date t only if its candle is dated at least two
calendar days earlier (`ml/global_features.py`, leakage tests in
`ml/test_global_features.py`).

**Inputs:**

* market-level: S&P 500, Nasdaq-100, Hang Seng and Nikkei trends; S&P 500 realised
  volatility and drawdown; Brent and USD/INR changes; Brent volatility
* stock-specific: each stock's 120-session sensitivity (beta) to Brent, USD/INR and
  the S&P 500, multiplied by the latest 20-session move

**Development folds** (`python -m ml.v5_study`). The gate was fixed before running:
+0.005 mean metric and better in at least 75% of folds.

| Model | Attempt 1: all development data | Attempt 2: from Oct 2020 only (3 folds) |
|---|---|---|
| Volatility v4 ensemble, AUC | 0.6575 → 0.6401 (2/4 better) | 0.6539 → 0.6484 (1/3) |
| Volatility v4 logistic, AUC | 0.6546 → 0.6243 (1/4) | 0.6560 → 0.6509 (1/3) |
| Ranking 5-session ensemble, IC | 0.0284 → 0.0250 (2/4) | 0.0117 → 0.0134 (1/3) |
| Ranking 20-session ensemble, IC | 0.0271 → 0.0354 (2/4) | 0.0320 → 0.0330 (1/3) |
| Ranking 20-session logistic, IC | 0.0314 → 0.0275 (3/4) | 0.0282 → 0.0275 (2/3) |

Attempt 2 removed the confound of training on years with missing global data. No
configuration passed in either attempt, so the holdout was not used and v4 stays.
Global effects reach NSE prices within a day and are already reflected in the
stock's own price, volatility and India VIX inputs. The collector stays in the
nightly job (non-fatal) for future research and for showing real global markets in
the app.

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
