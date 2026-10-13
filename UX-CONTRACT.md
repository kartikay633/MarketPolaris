# Existing frontend behavior contract

This redesign preserves existing behavior; the implementation is authoritative for API and business rules.

| Capability | Canonical owner | Presentation policy | Verification |
| --- | --- | --- | --- |
| Routes / navigation | `src/App.jsx`, Sidebar, TopBar | Retain every route and navigation item | Browser navigation |
| Query / mutation / state | Existing hooks, services, stores | No behavioral changes | Diff and handler comparison |
| Themes | `themeStore.js` | Retain existing key and theme actions | Toggle and reload |
| Forms | Existing page forms / react-hook-form | Retain validation and submit handlers | Browser fields and build |
| Select / listbox | Existing native selects and SearchModal | Native popup accepted; preserve options | Keyboard and selected options |
| Tables / selection | Existing page tables and list controls | Preserve all columns and sort/filter behavior; local horizontal overflow | Browser narrow layout |
| Date | Existing formatting and date fields | No changes to date logic | Diff |
| Toast | Existing Sonner provider | Theme follows visual theme | Browser theme |
| Scrollbar | `src/app/styles/index.css` | Visible themed scrollbar | Browser scrolling |
| CRUD / money actions | Existing page handlers and hooks | Preserve confirmations, mutations and financial behavior | Static parity; runtime subject to backend availability |
| Charts | Existing StockChart / MiniChart | Preserve series/data/timeframes; theme-only styling | Browser chart controls |
| Pulse AI | Existing AIPage / FloatingAIWidget | Preserve lab, conversation, messages and requests | Mode switching and chat |

No backend, authentication, API contracts, environment, dependencies, financial calculations, or data/state behavior are authorized to change. Existing application limitations must not be repaired through backend changes or hidden behind new mock data.
