# Filing reader: rollout protocol (written 19 October 2026, before any filing is read)

The filing reader is a local model (Qwen, 4B class, through Ollama) that reads the full text of
NSE filings and extracts facts that the one-line headline does not carry. It reaches the website
or the AI portfolios only after passing every stage below, in order. A failed stage stops the
rollout; the result is still written up in `ml/RESULTS.md`.

## Rules set by the founders

1. It must help, never pull the models down. Any stage where it makes a forecast worse is a fail.
2. Every claim is tested on data the reader and the models have never seen. Nothing ships
   because it is better on paper.
3. **9:1.** When the reader's information changes a decision, the change must be right at least
   9 times out of 10 (details per stage below).

## Stage 1: can the extraction be trusted? (pilot)

* 100 material filings from 2022 to 2024, drawn at random within material categories before any
  is read. Both the 4B and a 7B model read the same filings; Claude (in the development session)
  checks every extracted fact against the PDF.
* Gate: **at least 90% of extracted facts correct (9:1)** and **at least 95% of extracted numbers
  correct**. Every number must also appear verbatim in the filing text; numbers that do not are
  discarded automatically, before scoring.
* If the 4B fails and the 7B passes, the 7B is used only for the filing types where the 4B
  failed, within a backfill budget of one week of overnight runs.

## Stage 2: does it add information the headline does not? (development data only)

* Filings from 2022-01 to 2024-12-03 (the development period), with 1-minute prices from
  `ml.minute_history`.
* Compare headline-only inputs against headline + extracted facts, for the size and direction of
  the move after NSE's dissemination time (30 minutes, end of day, 5 sessions).
* Gate: the extracted facts improve the out-of-sample fit (rank IC or AUC) by a margin fixed in
  the study script before it runs, in at least 75% of walk-forward folds.

## Stage 3: when it changes a decision, is the change right? (holdout, scored once)

* Holdout filings from 2024-12-04 onwards, never used in stages 1 and 2.
* A **changed decision** is a case where adding the filing's facts moves the model's call across
  a decision line: calm ↔ elevated risk, or a stock entering or leaving the planner's picks.
* Gate for **risk alerts** (e.g. "this filing raises the risk of a large move"): **at least 90% of
  changed calls are right**, with the lower 95% confidence bound reported, and at least 30 changed
  calls so the ratio means something.
* Gate for **direction** (up versus down): changed calls must be right more often than the calls
  they replaced, with the 95% interval above zero. The 9:1 bar is reported for direction too, but
  stock direction is close to a coin flip even for the largest funds, so a 90% bar there would
  reject everything; this is stated before the result, not after it.
* In every case the overall holdout metric must not get worse.

## Stage 4: live shadow before customers

* The reader runs nightly on new filings and writes to a write-once forward ledger for at least
  four weeks, without changing anything users see.
* The stage-3 gates are re-checked on that live period. Only then does it reach the website, the
  planner or the AI portfolios.

## Holdings watch

For stocks held in the AI portfolios (and later in users' portfolios), the reader checks every new
NSE filing for those companies, not only those with market-moving headlines. Listed companies must
file material information with the exchange under SEBI LODR Regulation 30, so NSE filings are the
primary source. Sector regulators' official releases (RBI for banks and NBFCs, SEBI, IRDAI) and
public credit-rating rationales are added as sources and mapped to holdings by sector. Company
websites are used only for documents not filed with NSE, only where the site's robots.txt allows
it, and never by bypassing any access control.
