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
