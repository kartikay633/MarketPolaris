# Crisis replay study: hold, de-risk or buy the dip? (pre-registration)

Written and committed **before** any replay result. The study code is `ml/crisis_study.py`, with a
no-lookahead test in `ml/test_crisis_study.py`. Results go into `ml/RESULTS.md`. Nothing in the
product changes because of this study (`server/research/bots.js`, `advisor.js` and the customer
pages are not touched). A policy change is a separate decision for the founders, and per the team
rule it would also need a live shadow period first.

## Question

When the whole Indian market panics (a war, a pandemic, a crash), should Market Pulse's portfolio
rules carry on as they are, de-risk, hold without selling, or buy the dip? The target user is a
hands-off investor who will not add money or trade by hand.

## Data and timing

* Daily Upstox V3 candles in `data/pulse/candles` (from 19 Oct 2016; split-adjusted). The calendar is
  the NIFTY 50 sessions. India VIX is `INDIA_VIX` (`NSE_INDEX|India VIX`).
* Every decision for session *t* uses only candles dated *t* or earlier: the closing data is final
  by the 18:00 IST cutoff, the same as `closedSessionDate` in the app. Orders fill at the **open of
  session t+1**, and accounts are valued at each session's close.
* Cost is 0.12% per side on every fill. Cash earns nothing. No money is added, and there is no
  leverage or shorting.
* The five demerger ex-dates in `ml/rank.py` `CORPORATE_EVENTS` are price breaks, not returns. Ex-dates
  are announced in advance, so a held position in such a stock is sold at the open of the session
  before its ex-date. This affects every policy the same way.

## Crisis signal (mechanical, no hand-picked dates)

For each session *t*:

* **VIX rule:** India VIX close on *t* is above the 95th percentile of its closes over the previous
  252 sessions (*t−252 … t−1*; at least 240 of them needed).
* **Drawdown rule:** the NIFTY 50 close on *t* is at least 10% below its highest close of the last 60
  sessions (*t−59 … t*).
* **Signal on:** either rule holds.

An **episode** starts on the first signal-on session and ends on the last signal-on session before
10 consecutive signal-off sessions. Gaps shorter than 10 sessions merge into one episode. Each
episode is labelled **"drawdown"** if the drawdown rule fired at least once inside it, otherwise
**"VIX only"**.

The data should catch these known events, but they are **not** used to define anything. Which ones
the rule catches is itself a result:

* Oct 2018 IL&FS / NBFC sell-off;
* Feb–Mar 2020 Covid crash;
* Jan–Mar 2022 Russia–Ukraine war;
* May–Jun 2022 rate-hike sell-off;
* 4 Jun 2024 election-result day;
* Oct 2024 – Mar 2025 correction;
* Apr 2025 US tariff shock;
* any later episode in the stored history.

The Sep 2016 Uri strikes and Nov 2016 demonetisation come before the signal's one-year warm-up, so
they cannot be caught.

## The planner replay (Python port of the bot rules)

The bot rules are ported from `server/research/bots.js` and `advisor.js` (balanced profile, 1-month
plan):

* ₹2,00,000 start.
* Full rebalance every 21 sessions with `buildPlan`:
  * 10 names, 10% cash buffer, 15% weight cap, at most 2 per sector;
  * names ranked by the 20-session peer model;
  * inverse forecast-volatility weights, halved when volatility is elevated;
  * whole shares, then the top-up loop.
* Rebalance trades under 2% of equity are skipped for names already held.
* Every other session runs the `reviewPortfolio` check-up:
  * **sell** below the 2σ review floor;
  * **sell** if bottom quintile and elevated;
  * **trim** if overweight, or if elevated above 60% of the cap;
  * **add** if top quintile, not elevated, under 70% of target, and cash is spare.
* Fills follow `execute`: sells before buys, buys capped by cash, and an order is cancelled if the
  stock has no candle that session.

Model outputs are rebuilt point in time:

* **Ranking.** The live 20-session peer model is the `momentum_12_1` factor: a one-feature logistic
  on the cross-sectional rank of 12-1 momentum. It is refitted every 63 sessions on rows whose
  20-session label ended before the refit date. The planner only uses the ordering and the quintile,
  so ranking calibration (monotone) is not needed.
* **Volatility.** pulse-risk-v4 (the `ensemble` configuration and the exact `ml/risk.py` features,
  including the results calendar and implied volatility) is refitted every 63 sessions on matured
  rows only. Its sigmoid calibrator is refitted at each refit on all earlier out-of-sample raw
  predictions whose labels had matured. The tiers are fixed: elevated ≥ 0.65, calm ≤ 0.35.
* **Warm-up.** The first model fit needs 250 sessions of matured training rows. The first calibrator
  needs 126 sessions of matured out-of-sample predictions. The planner replay starts at the first
  63-session refit date after both exist, and every policy starts that day.

Known differences from production, all identical across policies b–e:

* Production refits on every evening. The replay refits every 63 sessions, the cadence the models
  were evaluated with.
* Production uses a calibrator fitted once on 2017–2024 development data. The replay uses a
  walk-forward calibrator instead, so it never sees the future.
* The model *choices* (momentum factor, v4 ensemble, feature list) were made with data up to about
  2024. The replay therefore tests crisis rules wrapped around today's planner. It is not an
  out-of-sample test of the models.
* The universe is today's 175 liquid stocks, so survivorship bias applies.
* The post-mortems in `bots.js` are not replayed (they do not trade).

## Policies

All policies use the same signal, models, costs and fills.

* **(a) NIFTY buy-and-hold.** All cash goes into NIFTY 50 at the first open (fractional units, one
  0.12% cost), then is held. This is the benchmark.
* **(b) Current bot rules.** As above, with no crisis logic.
* **(c) De-risk.** An exposure multiplier *e*:
  * *e* = 0.5 at any decision where the signal is on;
  * once the signal has been off for 10 consecutive sessions, *e* = 0.75;
  * after 21 off sessions, *e* = 1.0.

  Whenever *e* changes, a full rebalance runs that evening with plan budget ⌊equity × *e*⌋, and the
  21-session clock restarts. Check-ups use the same scaled budget. Cash held in this way earns
  nothing.
* **(d) Buy the dip.** On a signal-on decision the account enters dip mode:
  * a full rebalance runs at once with a **0% cash buffer** (about 100% invested; weight cap still
    15%);
  * check-up sells and trims are suspended (check-up adds still allowed);
  * monthly rebalances continue with the 0% buffer.

  Dip mode ends once the signal has been off for 21 consecutive sessions. A normal rebalance (10%
  buffer) then runs. Without new money or leverage, the only extra exposure available is the cash
  buffer plus the sells it avoids.
* **(e) Hold through.** The same as (d) but keeps the 10% buffer and does not rebalance on entry. It
  only suspends check-up sells and trims while in crisis mode, so it answers "don't panic-sell".

**Index-level arm (robustness, more episodes).** NIFTY 50 is the only asset, with fractional units,
the same costs and fills, a rebalance to target every 21 sessions and whenever the target changes,
and trades under 2% of equity skipped. It starts on the first session with a valid signal (about
Oct 2017), so it also covers 2018:

* (a′) 100% NIFTY;
* (b′) 90% NIFTY / 10% cash (the bot's buffer, no stock picking);
* (c′) 90% × *e*;
* (d′) 100% in dip mode, else 90%.

## Metrics

Accounts are valued at every close. Metrics:

* total return and CAGR;
* **max drawdown** (peak to trough, daily);
* **recovery time** (sessions from the peak before the max drawdown back to that peak, or "not
  recovered");
* **return per unit of drawdown**, CAGR ÷ |max drawdown|;
* the differences from NIFTY buy-and-hold in CAGR and max drawdown.

**Per episode:** the window runs from the close of the episode's first signal-on session to 63
sessions after its last signal-on session (or the end of data). For each policy it reports the
window return, the max drawdown inside the window, and NIFTY's return.

**Uncertainty:** a stationary block bootstrap (mean block 21 sessions, 2,000 draws, seed 20260419)
of the daily return difference against (b) gives a 90% interval for the annualised return
difference.

## Decision rule (fixed now)

A crisis policy X ∈ {c, d, e} **beats the current rules** only if all of these hold in the planner
replay:

1. **G1:** CAGR ÷ |max DD| over the full window is higher than (b)'s.
2. **G2:** CAGR is no more than 1.0 percentage point a year below (b)'s.
3. **G3:** the episode-window return beats (b)'s in at least two-thirds of episodes (rounded up).
4. **G4** (c and d only): in the index-level arm, the index version (c′ or d′) has higher CAGR ÷ |max
   DD| than (b′).

If several pass, the best is the one with the highest CAGR ÷ |max DD|. If none passes, the answer is
"keep the current rules", and the write-up says so. The write-up also reports, without changing the
verdict, whether anything beats NIFTY buy-and-hold.

**Confidence.** If the planner window has fewer than 8 episodes, or the bootstrap 90% interval for
the winning policy's annualised return difference includes 0, confidence is **low**. In that case
the most this study can justify is a live shadow test, not a product change.

**Non-decisional extras**, reported but unable to change the verdict:

* the same policies triggered by the drawdown rule alone and by the VIX rule alone;
* results split into "drawdown" and "VIX only" episodes.
