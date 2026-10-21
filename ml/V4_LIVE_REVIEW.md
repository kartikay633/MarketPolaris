# v4 live review: criteria (written 21 October 2026, before the results)

The Polaris AI v4 paper account started on 16 October 2026 with ₹2,00,000 and can never add
money. On **Saturday 26 December 2026** its record is analysed, using the close of 24 December
(the last session before the Christmas holiday). This is a checkpoint, not an end date: the
account keeps trading before, during and after the review. The criteria below were set by the
founders on 21 October, before the review period, and are not changed afterwards.

## How the account trades (unchanged by the review)

* A full rebalance every 21 sessions (about monthly): stocks no longer among the top-ranked,
  risk-sized picks are sold and new picks bought. About two rebalances (mid-November,
  mid-December) fall before the review, so it does not stay on its 16 October picks.
* A daily check-up between rebalances that can sell, trim or add to a holding.
* Every order is decided after the evening data update and filled at the next session's open,
  with about 0.12% cost per side. Losing exits get a written post-mortem.

## Reading on 26 December (account value at the 24 December close)

The verdict decides what we work on next; the account itself keeps running either way.

| Account value | Verdict | Next step |
|---|---|---|
| Below ₹1,85,000 | **Bad** | Change the model: find out why and retrain or replace it. |
| ₹1,85,000 to ₹2,00,000 | **Below start** | Look for stocks that would have done better, and why v4 did not pick them. |
| Above ₹2,00,000 | **Going well** | Keep v4, and still run the analysis below. |

Recorded alongside the verdict, as context:

* **NIFTY 50 over the same period.** The account is compared with NIFTY from 16 October. A fall
  that only follows a falling market is a different finding from losing while the market rose.
* **v4's live forecast accuracy** (5-session risk calls) against its 71% holdout accuracy.

## Analysis for every outcome

1. The NIFTY 50 stocks and other covered stocks that did better than the account's picks.
2. For each, why v4 did not pick it: rank, risk tier, or sizing.
3. Whether those stocks were due to fall soon after, which would have justified skipping them.

Also on 26 December: update the 2027 NSE holiday list in `server/utils/marketHours.js`.
