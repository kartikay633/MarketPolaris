# Pulse news provenance and source research

Research and collection performed 13 October 2026. This subsystem deliberately reports historical news model evaluation as **unavailable**. A dated document discovered today does not demonstrate that its current text was available at its printed publication time.

## Actual access evidence

| Source | Evidence and outcome | Suitable use and limitation |
| --- | --- | --- |
| [NSE announcements](https://www.nseindia.com/companies-listing/corporate-filings-announcements) and [official RSS](https://archives.nseindia.com/content/RSS/Online_announcements.xml) | Normal HTTPS RSS request returned 200. Twenty actual announcements collected, including exchange-hosted PDF/XML links. | Source of issuer disclosures and public broadcast metadata. A current feed is not a five-year archive. Some other feed items have empty links; bounded batches reject malformed records rather than inventing links. |
| [BSE announcements](https://www.bseindia.com/corporates/ann.html) | Browser research returned 403; direct normal fetch failed. No header spoofing, cookie harvesting, proxy or access-control bypass attempted. | Manual imports of approved HTTPS disclosure metadata supported. No BSE bulk historical collection claimed. |
| [RBI RSS directory](https://www.rbi.org.in/Scripts/rss.aspx) and [press releases feed](https://www.rbi.org.in/pressreleases_rss.xml) | Directory documents syndication; normal feed request returned 200. Ten actual press-release titles, links and dates collected. | Monetary-policy and regulatory context. Full article bodies are not retained. Source timestamps without timezone are interpreted as India local time, but observation remains the availability floor. |
| [Infosys investor filings](https://www.infosys.com/investors/reports-filings.html) and [Q3 FY2026 archive](https://www.infosys.com/investors/reports-filings/quarterly-results/2025-2026/q3.html) | Research found publicly indexed annual/quarterly filings and dated releases. | Useful candidate for manually reviewed issuer disclosures. Date-only pages do not establish intraday availability; no historical training records imported from these pages. |
| [NSE corporate data products](https://www.nseindia.com/market-data/corporate-data-subscription) | NSE describes paid end-of-day announcement distribution. | Comprehensive structured historical coverage is not assumed available under the zero-rupee budget. No subscription purchased. |

The first collection exposed an NSE parser defect: it attempted to parse items outside the requested batch, including announcements with no link. Collection now parses only the requested bounded batch. The failed attempt and subsequent successful collection remain in `collections`; records are never fabricated to conceal an error. Actual initial store: **30 observed records**, first observation `2026-10-13T17:16:33.059Z`. Counts may grow on later explicit runs.

Financial journalism and named reporters remain potential sources, not approved bulk collectors. Article availability, permission to retain text, original version history, byline and timestamp must be verified before inclusion. Search snippets and LLM recollections are not historical training evidence. A journalist's name is stored only when the source supplies it; no author or reputation is inferred. No source receives a fabricated reliability score.

## Storage and eligibility contract

`data/pulse/news.json` is ignored by Git and outside the frontend public directory. It contains schema version 1, append-only event versions and collection attempts. Writes use an exclusive lock and atomic replacement; existing event objects are preserved. The JSON file is local provenance storage, not a cryptographically signed or independently audited archive.

Each event records `id`, approved `sourceId`, `sourceType`, HTTPS `sourceUrl`, plain-text `title` and optional bounded `excerpt`, supplied `author`, explicit `symbols`, `publishedAt`, ingestion-assigned `firstSeenAt`, `availableAt`, `contentHash`, `recordHash`, `version`, `previousVersionId`, `correctionOf`, `novelty`, and deterministic `classification`. Exact repeated records are idempotent; changed content or metadata appends a new version. Correction references must identify an already observed record. Corrections never edit the earlier event. Missing symbols remain missing rather than guessing from company names.

`eligibility(event, predictionISO)` requires both publication and observation at or before prediction time. Imported `firstSeenAt`, `availableAt`, and `archiveVerified` claims are ignored. No CLI option can grant retrospective archival verification. A later corrected version becomes eligible only when observed; consumers must select the latest **eligible** version at the prediction timestamp. `novelty` means whether exactly the same title/excerpt has previously been observed. It is not proof that the underlying event is new, nor a semantic originality score.

Only deterministic rules classify topic (earnings, capital action, regulation, monetary policy, business event, governance or correction). No sentiment, return, credibility or probability is invented. Gemini's current explanations must remain outside historical feature generation: prompts cannot remove the possibility that a pretrained language model knows subsequent outcomes.

## Operation

```sh
node scripts/pulse-news.js collect --limit 20
node scripts/pulse-news.js status
node scripts/pulse-news.js import --file path/to/events.json
node --test tests/pulse-news.test.js
```

Import takes a JSON array with `sourceUrl`, `title`, timezone-qualified `publishedAt`, optional `excerpt`, `author`, `symbols`, and `correctionOf`. It never fetches arbitrary imported URLs. Approved sources are explicit exact hosts in the module; adding a source requires review. Fixed RSS collectors reject redirects and DTD/entities, use bounded responses and timeouts, record failures, and retain only short syndication metadata. Collection is manual/on-demand; no recurring job has been silently installed. Public access does not grant blanket commercial redistribution rights.

## Evidence required before news performance claims

Accumulate observations prospectively or obtain an independently audited archive of original text and actual availability times. Link events to instruments using verified identifiers. Freeze extraction rules before testing. Compare market-only and news-aware variants on the same dates, stocks, targets, costs and purged walk-forward folds. Evaluate novelty/corrections and source coverage with sufficient samples; report missing coverage and uncertainty. Source accuracy and source predictive value are different measurements. Neither one is established by this initial collection.
