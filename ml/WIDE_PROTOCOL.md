# Wide universe: protocol (written 21 October 2026, before any wide data is collected)

Question: do the live Polaris AI models (ranking pulse-rank-v2, volatility risk pulse-risk-v4)
hold up when they choose from four times as many stocks? Nothing here changes v4: its 175-stock
universe, models, paper account and the 26 December review (`ml/V4_LIVE_REVIEW.md`) are untouched.

## Universe (fixed now)

* The NIFTY Total Market index as published by NSE on 21 October 2026:
  `ind_niftytotalmarket_list.csv`, 755 stocks, SHA-256
  `b5e615e961ba861c38e191f0341dd1e352a92ea9cf9e3cfebb9de621cc323134`, saved as
  `data/pulse-wide/universe-niftytotalmarket-2026-10-21.csv`. It covers large, mid, small and
  micro caps, about 96% of NSE market value.
* Sector for peer-relative features: NSE's own industry label from that file (22 industries).
* The other ~2,200 NSE listings are not added: most trade too little for a forecast or a paper
  trade to be realistic. Polaris AI still answers questions about them from price, filing and
  news facts, without a forecast.
* Known bias, stated before results: today's index members are the survivors and risers of the
  last ten years (survivorship bias), as with v4's universe. The holdout therefore flatters; the
  write-once forward ledger is the unbiased test.

## Data (fixed now)

Separate folder `data/pulse-wide`, same sources and code paths as v4: ten years of Upstox daily
candles for the 755 stocks and the same benchmarks, NSE board-meeting intimations (results
calendar), and the existing NSE F&O bhavcopies (read only; implied volatility exists for F&O
stocks and is imputed with a flag for the rest, exactly as in v4).

## Models (unchanged code)

`ml/rank.py` and `ml/risk.py` exactly as committed, run with `--data-dir data/pulse-wide`: the
same features, candidates, purged walk-forward selection on the earliest 80% of dates,
calibration, and one evaluation of the final 20% holdout. No feature, setting or threshold is
tuned for the wide universe. The holdout is scored once; a failed gate is not re-run.

## Gates (all on the holdout)

1. **Risk, wide universe:** holdout ROC AUC at least **0.779** (v4's 0.789 less 0.01).
2. **Risk, no harm to the core:** on the stock-dates of the 174 stocks both universes share,
   the wide model's holdout AUC is at least v4's AUC on the same stock-dates less **0.005**.
3. **Ranking, the horizon the paper accounts trade (20 sessions):** mean daily rank IC with the
   lower 95% bound (circular date-block bootstrap, as reported) **above zero**, and the
   cost-adjusted top-portfolio excess return versus the universe **above zero**.

## What follows

* **Gates 1 to 3 pass:** a third paper account, *Polaris AI wide (shadow)*, starts with
  ₹2,00,000 on the next evening run, choosing from the wide universe with the same rules as the
  v4 account, plus one trading rule fixed now: it buys only stocks whose 20-session average
  traded value is at least ₹10 crore. It is compared with v4 on 26 December and after. v4 stays
  the live model until the shadow account beats it forward, judged then.
* **Gates 1 and 2 pass, gate 3 fails:** no wide account; the wide risk tiers may be shown on stock
  pages for the added stocks, labelled with their own holdout accuracy.
* **Gate 1 or 2 fails:** nothing from the wide models is used. The result is written up in
  `ml/RESULTS.md` either way.

## Amendment 1 (21 October 2026, before any wide model is trained or scored)

The founders asked for the best model the data allows, with no time limit. The unchanged-code run
above was stopped before its training began, so no wide result of any kind exists. This amendment
was written while the extra decade of candles (item 1) was downloading; nothing else had run.

1. **Twenty years of history** where Upstox has it: daily candles from 22 October 2006 (India VIX
   from March 2009), adding the 2008, 2011, 2013 and 2015-16 stress periods. Individual invalid
   candles are dropped (and `ml.pulse.load_candles` validates again) instead of rejecting a whole
   stock, which restores Mazagon Dock, South Indian Bank, Vodafone Idea and Yes Bank.
   Implementation: `scripts/pulse-wide-history.js`.
1b. **Demergers and schemes** (added the same evening, still before any model run). Upstox adjusts
   splits and bonuses but not demergers, so a demerger looks like a crash. v4 excludes five such
   events found by scanning for overnight gaps above 25% and checking each one. For 755 stocks over
   twenty years the check is automated against NSE's corporate-actions record: an event is a date
   on which the stock gapped more than 25% overnight **and** NSE lists a demerger, scheme of
   arrangement or capital reduction for it within three days. Events are excluded exactly as in v4
   (label windows containing them, features in the following 252 sessions). Large gaps with no
   such NSE record stay in the data as genuine moves. Implementation: `scripts/pulse-wide-events.js`
   and `ml/wide.py`.
2. **Holdout fixed by date:** every row dated on or after **4 December 2024**, the start of v4's
   risk holdout, so all comparisons use the same unseen period. Development is every earlier row
   whose label ends before that date; four expanding, purged walk-forward folds start at 40%, 55%,
   70% and 85% of development dates, as in v4.
3. **Candidates, declared now.** Development folds only choose among these.
   * Risk (same target, calibration and refit-every-63-sessions holdout protocol as v4):
     * *R-v4*: v4's inputs and its four candidates (persistence, logistic, gbm, ensemble), v4 settings.
     * *R-wide*: v4's inputs plus four same-date cross-sectional inputs: the stock's volatility
       versus its sector's median, the same-date rank of current-versus-normal volatility, the
       same-date rank of 20-session traded value, and the share of stocks whose volatility is above
       normal (market-wide stress breadth); the same four candidates.
     * *R-gbm+*: gradient boosting with more capacity (600 trees, learning rate 0.03, 63 leaves,
       minimum leaf 1,000) on R-wide inputs, alone and averaged with the logistic model.
   * Ranking (20-session peer target decides; 5-session reported):
     * *K-v2*: rank-v2's inputs and seven candidates.
     * *K-wide*: plus the same-date ranks of 20-session traded value and of the 120-session return
       relative to the sector; the same candidates.
     * *K-gbm+*: boosting with more capacity (500 trees, learning rate 0.02, 31 leaves, minimum
       leaf 2,000) on K-wide inputs, alone and averaged with the logistic model.
4. **Selection:** highest mean development ROC AUC (risk) and highest mean development rank IC
   (ranking, 20 sessions). Candidates within 0.002 of the best count as tied; the simpler wins
   (fewer inputs, then less capacity).
5. **Final evaluation, once:** the selected candidates and the best unchanged-method candidates
   (R-v4, K-v2) are scored on the holdout in one run (`python -m ml.wide final`). The gates above
   apply to the selected candidates, unchanged; the unchanged-method scores are reported beside
   them. Gate 2 compares with v4's saved holdout predictions on shared stock-dates.
