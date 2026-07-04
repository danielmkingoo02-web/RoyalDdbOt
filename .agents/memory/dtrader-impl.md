---
name: DTrader implementation approach
description: How the DTrader manual trading tab is built and why certain choices were made
---

## Rule
The DTrader tab (`src/pages/dtrader/index.tsx`) uses `api_base.api` WebSocket directly for all data (ticks, proposals, buy). The `dtrader-template` repo at github.com/danielmkingoo02-web/dtrader-template is a reference for UI/layout only — its internal deps (`@deriv/stores`, `Stores/useTraderStores`, `useContractsFor`, etc.) don't exist in deriv-bot and cannot be imported.

**Why:** The template is a separate monorepo (`packages/trader`) with its own store layer. Embedding it as-is would require a full store migration.

**How to apply:**
- Layout/design: mirror the template's structure (trade-type chips header, market selector bar, chart-left/params-right grid, purchase buttons)
- Data: all WebSocket calls go through `api_base.api.send(...)` and `api_base.api.onMessage().subscribe(cb)`
- The canvas-based live chart plots raw tick quotes received from the `ticks` subscription
- Tab is at hash `#dtrader`, rendered via lazy import in `src/pages/main/main.tsx`, wrapped in `.dtrader-wrapper` (height: calc(100vh - 9rem))
