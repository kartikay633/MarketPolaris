# Market Pulse design system

Market Pulse is an Indian financial intelligence terminal for scanning markets, researching equities, managing watchlists and portfolios, and practising paper trading. The existing feature set and all business behavior are authoritative.

## Visual direction

A compact research workstation: graphite navigation, calm slate surfaces, thin separators, aligned financial figures, and restrained blue actions. Benchmark indices lead the dashboard, followed by participation, market intelligence, and actionable stock tables. Typography and layout establish hierarchy; gradients, glows, and oversized banners do not.

## Canonical runtime ownership

`src/app/styles/index.css` owns semantic CSS variables and shared visual primitives. DESIGN.md documents their intent; it does not generate a second token system. Existing components consume the same variables in both themes. `themeStore.js` retains its existing persistence key and behavior.

- Dark background/surface: `#10151e` / `#171e29`.
- Light background/surface: `#f3f5f8` / `#ffffff`.
- Dark primary/secondary text: `#edf2f8` / `#b0bccd`.
- Light primary/secondary text: `#172338` / `#46566c`.
- Blue action: dark `#659cff`, light `#275dcc`; filled primary controls use `--accent-deep` and white text.
- Gain/loss: dark `#58c5a1` / `#fa8691`; light `#08785c` / `#bd3149`. Preserve signs, icons, and labels in addition to color.
- Type: existing Inter body, Space Grotesk for headings/brand, JetBrains Mono for numerical data; system fallbacks remain available.
- Controls/panels: 6px / 8px radii, thin borders; shadows reserved for floating overlays.
- Spacing: 4/8/12/16/24/32px rhythm, 14px body, 12px supporting labels, 26px page titles.
- Desktop: 212px sidebar; tablet: compact icon navigation with labels exposed on focus/hover; mobile: all navigation links available in a horizontally scrollable header.
- Tables own horizontal overflow. Page grids stack on narrow screens; no columns or controls disappear for cosmetic reasons.
- Motion: short color/opacity transitions; respect reduced motion. Scrollbars remain visible.

## Component and scope contract

Retain shared cards, buttons, inputs, native selects, tab groups, chart components, skeletons, ErrorBoundary, and Sonner notifications. Preserve every handler, query, mutation, validation rule, route, prop, and financial calculation. Frontend changes only. Existing data fallbacks are inherited behavior, not verified live information; no new fabricated metrics or AI outputs may be added.

## Verification

Compare the dashboard and sibling pages in both themes, check theme persistence, narrow viewports, keyboard focus, search, tabs, filter controls, charts, and both Pulse AI modes. Run the existing production build and inspect Git scope against the pre-edit checkpoint. Database/provider failures must be reported honestly without backend changes.

## Pulse AI research extension — October 2026

The subsequent prediction-engine request authorizes a dedicated backend/data subsystem and replacement of the Pulse AI page. Earlier frontend-only limits still describe the completed visual overhaul, not this newly authorized subsystem. Other pages, trading, authentication and shared AI integrations retain their existing contracts.

Pulse AI uses the existing slate tokens and compact table primitives. Its research views distinguish model probability, observed test accuracy, source facts and Gemini interpretation. Every result carries a data date and model version. Empty, stale, unavailable, unproven and provider-failure states are first-class states. No percentage is shown without measured data. Historical news availability must be explicit. Native symbol/horizon selectors intentionally use platform-owned popups. The detailed design and leakage contract is in `docs/pulse-engine-plan.md`.

## Flight Deck redesign — October 2026

Supersedes the slate visual direction above; behavior contracts are unchanged. The app continues the 3D intro's world: deep-space ground `#030508`, instrument-white type `#e8ecf1`, one electric blue `#3b82f6` (brand, live state, focus, selection). Gain `#4ade9b` / loss `#f05264` always carry a sign and ▲/▼.

- Tokens and primitives live in `src/app/styles/flightdeck.css`, loaded after `index.css`; light theme is redefined there under `[data-theme="light"]`.
- Type: Barlow (display figures, titles, uppercase tracked navigation), Geist (UI text), Geist Mono (numbers, labels, timestamps). The intro keeps its own fonts.
- Shell: a sticky top bar (brand, all routes including Settings, search, status, theme, alerts, account) over the live ticker; it wraps to two rows below 1360px and scrolls horizontally on phones.
- Panels are hairline-ruled panes (1px gaps on a border-colored grid), 2–4px radii; primary actions are white-on-ink, not blue.
- Dashboard hero: NIFTY 50 level, readouts, and the latest session's intraday trace drawn from `/stocks/:symbol/history?interval=1D`; when candles are unavailable it falls back to the day-range rail.
- Logo: `BrandMark` renders the same vector paths the intro extrudes (`src/intro/config.js`).
- Motion: trace clip-reveal, sector bar growth, slow star drift and grid run; all disabled under reduced motion. Entrances use opacity only so dialogs are never trapped in a transformed layer.
