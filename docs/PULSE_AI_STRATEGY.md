# Pulse AI — strategy, accuracy roadmap and testing plan

*18 October 2026. Internal document for the owner.*

## 1. Where we honestly stand

| Engine | What it predicts | Unseen-period result | Verdict |
|---|---|---|---|
| pulse-rank-v2 (5 sessions) | Will a stock beat the median NSE large/mid cap? | 51.5% accuracy, rank IC +0.041 | Small, real edge. Typical of the best published work. |
| pulse-rank-v2 (20 sessions) | Same, one month | 51.3%, IC +0.025 | Not established. |
| **pulse-risk-v3** (20 sessions) | Will price swings exceed the stock's normal level? | **70.6%**, AUC 0.784; **81%** on the confident half, **86%** on the top fifth | Strong. This is our competitive core. |
| Disclosure text (TF-IDF, fine-tuned Qwen 0.5B) | Big first-day move / tradable direction | Big move AUC 0.66 / direction 0.51 | Text predicts *size*, not *direction*, once a filing is public. |

The write-once forward ledgers (`data/pulse/forward/…`) and the planner ledger
(`data/pulse/advisor/plans/…`) are the only untouched tests. Every claim we make
publicly must eventually come from them.

## 2. What the research and competitors say

* **Direction is hard for everyone.** Gu, Kelly & Xiu (RFS 2020), the reference
  study of ML for stock returns, reports out-of-sample monthly R² below 1%; the
  value comes from ranking many stocks, not from calling single stocks right.
  Indian cross-section studies (Lalwani & Meshram, *Applied Economics* 2022) find
  the same pattern: modest, real predictability from momentum, size, cash-flow
  yield and short-term reversal.
* **LLMs on news:** Lopez-Lira & Tang (arXiv 2304.07619, v6 Oct 2025) find GPT-4
  scores the *initial* reaction well (≈90% portfolio-day hit rates) but that
  reaction is not tradable, and returns from the strategy fall as LLM adoption
  rises. Our own result (direction AUC 0.51 after publication) agrees.
* **Volatility is where models win.** HAR-type and well-fitted linear models are
  "hard to beat" (Audrino & Chassot 2024, 1,445 stocks); ML helps at longer
  horizons (Christensen, Siggaard & Veliyev, *J. Fin. Econometrics* 2022). Our
  logistic/ensemble result fits this literature.
* **Using volatility to size positions raises risk-adjusted returns.** Moreira &
  Muir (NBER w22208; *J. Finance* 2017) report Sharpe ratio gains of 50–100%
  across equity factors from scaling exposure by recent variance. The planner
  uses this directly.
* **Foundation models:** Kronos (arXiv 2508.02739, AAAI 2026) is pre-trained on
  12 billion candles and reports large RankIC and volatility-error improvements
  over earlier time-series models. Open checkpoints exist; worth testing as an
  input, not as a replacement.
* **Earnings drift in India:** evidence is mixed. A negative drift after *bad*
  earnings news shows up in several Indian studies; good news is priced fast.
* **Competitors' accuracy claims are mostly backtests.** For example, Danelfin's
  headline +14.69% annual alpha is explicitly a backtest; no independent audit
  was found. Indian tools (Tickertape, Trendlyne, StockEdge, Multibagg,
  broker-linked assistants) compete on screeners and chat, not on audited
  forecasts. **An audited, never-edited forward track record is a genuine
  differentiator.**

## 3. Accuracy roadmap (ranked by expected gain per week of work)

1. **Stock-level implied volatility from NSE F&O data.** For the roughly 180 F&O
   stocks, option prices are the market's own forward volatility forecast and
   normally the single best predictor of future volatility. NSE publishes daily
   F&O bhavcopies historically. Expected: the largest remaining volatility gain,
   plausibly toward the mid-70s overall.
2. **Quarterly results content (XBRL filings already linked in our NSE data).**
   Profit and revenue growth versus last year, and the size of the surprise.
   This targets the documented negative drift after bad results and improves the
   volatility calendar (big surprises mean big moves).
3. **Delivery percentage and bulk/block deals (NSE daily archives).** Delivery
   share is an India-specific measure of conviction buying; bulk deals expose
   institutional flows. Candidate inputs for the ranking model.
4. **Insider and promoter trades (SEBI PIT/SAST filings, already collected).**
   Promoter *purchases* are a documented positive signal; pledges are a risk flag.
5. **Qwen tags (tagging in progress, ~14 h).** Event type, tone and magnitude as
   ranking and volatility inputs, tested on development folds only.
6. **Kronos-small embeddings or forecasts** as extra inputs (CPU/GPU feasible).
7. **Wider universe (NIFTY 500).** More stocks give cross-sectional models more
   breadth, and mid/small caps are less efficiently priced. Liquidity filters and
   costs must be modelled before any recommendation uses them.
8. **Monthly fundamental model** (valuation, quality, earnings revisions) for the
   3-month and 1-year planner horizons, which today rely on 20-session outlooks
   plus rebalancing.

Rule for every item: choose on development walk-forward folds only, score the
holdout once, ship as a new version with its own forward ledger, and keep the
old ledger untouched.

## 4. How we test, from tomorrow

* **Daily, automatic (Task Scheduler, Mon–Fri 22:00 IST):** update data, refit,
  write write-once forecasts for ranking and volatility, record 12 model
  portfolios (3 risk styles × 4 horizons, ₹10 lakh each), and score everything
  that has matured.
* **Scorecards:**
  * Volatility: accuracy, AUC and tier precision on matured forecasts.
  * Ranking: accuracy and rank IC.
  * Planner: share of model portfolios beating NIFTY 50 and mean excess return
    over the same dates (`reports/advisor-forward.json`).
* **Minimum evidence before any public claim:**
  * 60 matured sessions for 5-session results.
  * 6 months for 1-month plans.
  * Always with confidence intervals.
* **Overfitting control:** count every variant we try. When choosing among
  strategies, report the deflated Sharpe ratio (Bailey & López de Prado 2014)
  and the probability of backtest overfitting, rather than the best backtest.
* **Monthly review:**
  * Compare forward results with the holdout.
  * A large shortfall means the holdout was optimistic. Say so and fix the
    model, never the record.
* **Costs:** model results include 20 bps round-trip. The planner track record
  should add brokerage, STT and slippage before it is shown to customers.

## 5. Product roadmap

**Shipped today:**
* **Plan my portfolio.** Budget, horizon and risk style in; whole-share
  quantities out, sized to each stock's expected risk, with sector caps, a cash
  buffer, review levels and plain-language reasons.
* **Daily check-up.** Buy more / hold / trim / sell for each paper holding, with
  one-click paper orders.
* **Track record.** The public scorecard of model portfolios.

**Next:**
1. **Daily alerts.** Email or web push after the evening run: "2 actions for your
   portfolio today". This needs user consent and notification infrastructure.
2. **Onboarding questionnaire.** Goals, experience and loss tolerance map to a
   risk style, replacing self-selection.
3. **Goal tracking.** Progress versus NIFTY and versus the plan, with a
   rebalancing reminder at each horizon.
4. **Explain any action in chat.** "Why sell TCS?" pulls the same evidence the
   check-up used.
5. **Fix the ticker tape.** It shows hard-coded sample prices next to live index
   data, which damages trust instantly.
6. **Transparency page.** How Pulse AI works, what it cannot do, and the live
   forward scorecard.

## 6. Before real money: legal and data

* **SEBI registration.** Personalised buy/sell/hold recommendations to the
  public are research-analyst or investment-adviser activity. They require SEBI
  registration (RA Regulations 2014, IA Regulations 2013, both amended Dec
  2024). Since January 2025 these rules also require disclosure of AI use, and
  the registered entity stays responsible for AI output. Paper trading for
  testing is fine, but launch to real-money users only after registration or
  through a registered partner. Never advertise returns or guarantees.
* **Data licences.** Commercial redistribution of NSE prices and index data
  needs exchange or vendor licensing. Check the Upstox API terms for commercial
  use too. Disclosure text is public, but verify the terms for automated
  collection at scale.
* **Plain language:** every recommendation is model-based research supporting
  the user's own decision, with the measured track record beside it.

## 7. Realistic ambition

Large investors win through information, scale, low costs and strict risk
management, not by calling every stock right. Our realistic edge:

* **Discipline:** a consistent process applied every day.
* **Breadth:** 175 stocks studied every evening.
* **Risk management:** volatility-managed sizing, our strongest evaluated model.
* **Speed:** research a person would spend hours on, prepared in seconds.
* **Honesty:** a track record nobody can edit.

That combination can compete with good human process. The forward ledgers will
show, month by month, whether it does.

## Sources

* Gu, Kelly & Xiu, *Empirical Asset Pricing via Machine Learning*, NBER w25398 — https://www.nber.org/papers/w25398.pdf
* Lopez-Lira & Tang, *Can ChatGPT Forecast Stock Price Movements?* — https://arxiv.org/abs/2304.07619v5
* Christensen, Siggaard & Veliyev, ML vs HAR for realized variance — https://repec.econ.au.dk/repec/creates/rp/21/rp21_03.pdf
* Audrino & Chassot, *HARd to Beat* — https://arxiv.org/html/2406.08041v1
* Moreira & Muir, *Volatility-Managed Portfolios* — https://www.nber.org/papers/w22208.pdf
* Kronos foundation model — https://huggingface.co/papers/2508.02739
* Lalwani & Meshram 2022, Indian cross-section with ML — https://ideas.repec.org/a/taf/applec/v54y2022i16p1814-1828.html
* Indian earnings-drift evidence — https://eprints.nottingham.ac.uk/26569 , https://file.scirp.org/Html/20-1501629_88060.htm
* Bailey & López de Prado, *The Deflated Sharpe Ratio* — https://papers.ssrn.com/abstract=2460551
* Danelfin backtest disclosure and review — https://diyai.io/ai-tools/finance/reviews/danelfin-review/
* SEBI AI-disclosure rules for RAs/IAs (secondary coverage) — https://www.business-standard.com/markets/news/sebi-issues-new-guidelines-for-research-analysts-investment-advisers-125010801273_1.html , https://www.outlookmoney.com/invest/disclosing-ai-usage-in-investment-advisory-and-ensuring-data-security-is-a-must-sebi-issues-new-rules-for-ras-and-ias
* SEBI registration requirement and finfluencer rules — https://indiacorplaw.in/2023/09/11/sebis-proposed-regulations-on-finfluencers-navigating-unresolved-practicalities/ , https://www.barandbench.com/law-firms/view-point/cutting-the-cord-sebi-move-disrupt-unregistered-finfluencers-business-model
