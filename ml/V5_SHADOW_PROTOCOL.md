# Polaris AI v5 (shadow): search protocol (written 22 October 2026, 00:30 IST, before any v5 experiment)

*File history: committed first as `ml/V5_PROTOCOL.md` in dffaa2d (22 October 2026, 00:30 IST, before any v5
experiment), which by mistake replaced the 19 October intraday study's protocol of the same name. That protocol
is restored under its own name and this one moved here, unchanged.*

The wide study (`ml/WIDE_PROTOCOL.md`, results in `ml/RESULTS.md`) failed its risk gates and was not
used; its ranking model passed. The founders asked for the best model the wide data allows, named v5,
run as a shadow paper account beside v4. v4's models, universe, account and 26 December review are
untouched; v4 stays the live model.

## What is already spent

The holdout (every row from 4 December 2024) was scored once on 21 October 2026 for the wide R-v4
ensemble and K-v2 gbm. Any further holdout score is a **second look** and flatters. So:

* every choice below is made on **development folds only** (the four purged walk-forward folds of
  amendment 1, labels ending before 4 December 2024);
* the holdout is scored once more, for the chosen v5 only, at the end, and reported as a second look;
* the unbiased test is the forward record of the shadow account, from its first evening.

## Data

`data/pulse-wide` with amendments 1, 1b and 1c (`clean()` in `ml/wide.py`), unchanged.

## Universe that counts

The shadow account buys only stocks whose 20-session average traded value is at least ₹10 crore a day;
on 21 October 2026 that is 672 of 747 stocks (90%). Research uses the same share on every date, so old
years are not judged by today's money values: a row is **tradable** when its 20-session traded value
is in the top 90% of that date. Selection metrics are computed on tradable rows; ranking information
coefficients are computed across tradable stocks only. Training may use any rows.

## Search

Any number of variants may be tried: training windows and weights, universes, targets (classification
or regression), feature sets, model families (scikit-learn, XGBoost, CatBoost) and settings, blends.
Every variant tried is appended to `data/pulse-wide/reports/v5-search.jsonl` with its development
scores, so the number of trials is reported with the result.

* **Risk:** the 20-session volatility target of v4 (future 20-session volatility above the stock's
  normal level). Score: mean development ROC AUC on tradable rows.
* **Ranking:** 20 sessions, as the account rebalances. Score: mean development daily rank IC across
  tradable stocks; the cost-adjusted top-20 portfolio is reported beside it.
* **Choice:** the best mean score; variants within 0.002 of it count as tied and the simplest wins
  (fewer inputs, then a single model over a blend, then less capacity).
* The fold-by-fold scores are reported for the chosen variants, so a win from one fold is visible.

## Final check, once

`python -m ml.v5 final` scores the chosen risk and ranking variants on the holdout, with the
refit-every-63-sessions protocol and a calibrator fitted on development predictions, and compares
them with the wide baselines already scored there (on the same tradable rows):

* If the chosen risk variant's AUC is more than 0.005 below the baseline R-v4 ensemble's, v5 uses
  the baseline risk model instead. The same applies to ranking against K-v2 gbm (mean IC).
* The shadow account starts if v5's ranking information coefficient has a lower 95% bound above zero
  on tradable holdout rows. If not, nothing starts and the result is written up.

## Shadow account

*Polaris AI v5 (shadow)*: ₹2,00,000 of paper money, the same planner rules as the v4 account (balanced
profile, one-month horizon, rebalance every 21 sessions, daily check-ups, next-open fills, 0.12% costs
per side), choosing from the wide universe and buying only stocks trading at least ₹10 crore a day.
The production models are refitted on all labelled data each month (every 21 sessions), with the
chosen settings fixed. Forecasts are written to a write-once forward ledger. The account is compared
with v4 at the 26 December checkpoint and monthly after; v5 cannot replace v4 on fewer than six months
(126 sessions) of forward record, and that decision is the founders'. Customer pages show the account,
not model internals.
