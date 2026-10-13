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
