# Market Pulse frontend redesign

## Company-logo clarity follow-up

The shared company-logo component now prefers bundled original company artwork for the main badges, skips undersized successful favicon responses, and caps raster rendering to native pixel density. Tata badges use the official 180px group artwork; HDFC uses its original vector emblem; TCS, Reliance, ICICI and ITC use original higher-resolution company assets. News badges grew from 14px to 20px. Source attribution is in `public/company-logos/SOURCES.md`.

The production build and whitespace check pass after this change. Browser inspection verified nine loaded logos on the trading page with zero upscaled raster images at device pixel ratio 1.25, plus 20px news badges without page overflow. Evidence is in `artifacts/ui/company-logos.jpg`. Only image-presentation lifecycle, asset selection, and badge sizing changed; market/backend behavior remains untouched.

## Checkpoint and scope

The downloaded folder had no Git repository. Local commit `ac8a8b4` preserves the original application before edits. Secrets and installed dependencies remain excluded by the existing ignore rules. Redesign changes are left uncommitted for review.

Changes are confined to frontend JSX/presentation, the shared stylesheet, and design/verification artifacts. No backend, hooks, services, stores, authentication, API contracts, environment/configuration, dependencies, domain constants, formatters, financial calculations, or trading calculations were modified.

## Implemented

- A shared slate/blue terminal system with semantic light/dark colors, readable numeric typography, flat panels, consistent controls, visible focus/scrollbars, and reduced-motion handling.
- Dashboard hierarchy now starts with benchmark indices. Existing capital actions, market telemetry, research, news, breadth, all four mover tabs, sector performance, and heatmap navigation remain available.
- Consistent styling across markets/screener, stock details/charts, watchlists, portfolio, paper trading/order history, news, alerts, settings, authentication, onboarding, both Pulse AI modes, and the floating assistant.
- Tablet icon navigation and phone horizontal navigation retain all nine navigation links. Panel grids adapt; wide data tables own horizontal scrolling. Stock actions and OHLC legends wrap; dialogs layer above navigation.
- Existing theme persistence is retained; chart surfaces and Sonner notifications follow the visual theme.
- All new display content is interface labeling or explanatory copy. No prices, news, market metrics, or AI responses were fabricated by this redesign. Existing application data/fallback behavior is unchanged.

## Verification evidence

- Production Vite build passed before editing and after implementation. The existing large-chunk warning remains; no unrelated bundling/dependency changes were made.
- Git diff whitespace check passed.
- AST comparison passed across 24 modified JSX files: original event/data bindings and query/state hooks are preserved. The intentional chart-layout theme adapter was normalized separately; its data logic and effect dependencies match the checkpoint. See `frontend-verification.json`.
- Browser inspection covered desktop (1280px), tablet (1024px), and phone (390px), both themes, theme reload persistence, and key responsive states. The final dashboard has no document overflow at those widths and retains all navigation links.
- Exercised search open/clear/filter/keyboard selection, dashboard tabs/refresh, screener presets/sector selection/no-results, heatmap switching, stock chart type/timeframe changes, watchlist input enablement, portfolio empty state, alert creation form/condition/cancel, settings edit/cancel/theme, trading side/limit/quantity/inventory validation, news categories/headline filters, and both onboarding steps.
- Pulse AI conversation sent a real request and displayed the existing backend response. Research lab results and all three result tabs were exercised. Floating assistant open/minimize was verified.
- Login/signup layouts were inspected; credentials were not submitted. Profile preferences, alerts, watchlists, portfolio balances, and orders were not saved or reset during checks.
- Screenshots: `artifacts/ui/dashboard-dark.jpg`, `dashboard-light.jpg`, and `dashboard-mobile.jpg`.
- This repository has no existing test, lint, formatter, or typecheck scripts. No claim of passing an absent automated suite is made.

## Existing limitations

- The local PostgreSQL connection is refused at port 5432. The existing server starts with its own fallback behavior. Database-backed create/update/delete actions and order submission were not end-to-end verified.
- The configured Gemini provider reports a 404 and the existing backend generates its own fallback synthesis. Browser checks prove requests, response rendering, and controls work; they do not prove provider quality or the truth of inherited fallback figures.
- Some current dashboard/screener/AI/news values, claims, and illustrative sparklines are already hardcoded or supplied through existing fallbacks. They remain untouched to comply with strict behavior preservation and must not be treated as verified live market information.
- The premium static checker reports eight findings in `frontend-static-audit.json`: six existing forms use their existing browser/application validation rather than the checker's requested `noValidate` convention; two existing native selects need a machine-readable ownership manifest. Native selects are explicitly accepted in `UX-CONTRACT.md`. Changing validation behavior or introducing a new audit configuration was outside this presentation task. These are documented, not concealed as passing checks.
- This is a focused browser verification, not a complete accessibility certification or verification of every backend mutation.
