---
name: DTrader Implementation
description: How the Manual Trading tab is built — SmartChart integration, subscription management, trade types
---

## Rule
Use `api_base.api` (WebSocket) for all data — ticks, proposals, buy, balance. Do NOT import from the dtrader-template monorepo (its deps don't exist in this codebase).

**Why:** The dtrader-template-master.zip is a complex monorepo using `@deriv/stores`, `useTraderStore`, `@deriv/components`, etc. that are not installed here. The `api_base` singleton already owns the authorized WebSocket connection.

## SmartChart integration

- Import `{ SmartChart }` from `@deriv/deriv-charts` (already a dependency, served from `node_modules/@deriv/deriv-charts/dist/`).
- Import `@deriv/deriv-charts/dist/smartcharts.css` alongside.
- Wire: `requestAPI = api_base.api.send`, `requestSubscribe` manages per-sub `onMessage` listeners filtered to subscription ID, `requestForgetStream = api_base.api.forget + unsubscribe`.
- **Never pass `topWidgets={null}`** — SmartChart renders it as `<null/>` → "Component is not a function". Always pass a render function, e.g. `topWidgets={() => <></>}`.
- Do NOT use `observer()` wrapper on the DTrader component; it causes "Component is not a function" in React.lazy context (HMR artifact but confusing). Plain function component is fine.
- Chart subscription ID tracked in `chartSubIdRef` (component ref, not module-level var) to allow multiple instances.

## Subscription lifecycle (fixes applied)

- **Tick subscription**: Track ID in `tickSubIdRef`; forget previous before re-subscribing on symbol change; forget on unmount.
- **Proposal subscriptions**: Track call + put IDs in refs; use `proposalTokenRef` counter to guard against stale responses (increment token on each new request, check in `.then()` callback). Forget both on effect cleanup and unmount.
- **SmartChart messages**: Filter `onMessage` in `requestSubscribe` to `data.subscription?.id === newSubId` to avoid leaking chart messages into proposal/tick handlers.
- All four subscription types (tick, proposal-call, proposal-put, chart) are forgotten on unmount.

## Trade types

Ten types implemented via a `family` discriminant on the trade-type catalogue: `'updown'` (Rise/Fall, Higher/Lower, Touch/No Touch, Over/Under, Matches/Differs, Even/Odd — classic call/put), `'accumulator'` (single-sided, no duration, `growth_rate` param), `'multiplier'` (call/put, no duration, `multiplier` + optional `limit_order.take_profit/stop_loss`), `'turbo'`/`'vanilla'` (call/put, duration + barrier, same shape as barrier `updown` types but distinct contract_type names).

- **Digit types** (Over/Under, Matches/Differs): barrier = `selectedDigit` (0–9 integer), always `duration_unit: 't'`.
- **Even/Odd**: no barrier needed, no digit selector shown.
- **Barrier types** (Higher/Lower, Touch/No Touch, Turbos, Vanillas): barrier = relative offset string like `+1`, shown in UI with increment/decrement.
- **Rise/Fall**: no barrier, supports ticks/min/hours duration.
- **Single-sided contracts** (e.g. Accumulators) use a `single_sided: true` flag on the trade-type entry — check this flag everywhere the put side is rendered/requested, don't special-case by id.

## Proposal stream matching (non-obvious gotcha)

When matching an incoming streamed `proposal` WS message to a tracked subscription, compare against `message.subscription.id`, never `message.proposal.id`. `proposal.id` is the *offer* id and changes on every price tick; `subscription.id` is the stable id returned once when the subscription was opened. Matching on `proposal.id` silently drops every update after the first one.

## Embedding self-contained legacy bots (Autotrades tab)

For bots that are fully self-contained HTML/JS files managing their own WebSocket + OAuth (not wired to `api_base`), serve them as static files under `public/<dir>/` and embed via `<iframe>` rather than porting to React. Always set `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"` (or narrower) on the iframe — an unsandboxed same-origin iframe can reach into the parent app's session/DOM.

## HMR "Component is not a function" artifact

This error fires briefly during CSS HMR rebuilds (the JS and CSS rebuild in two separate steps; mid-way React tries to re-render with a partially-loaded module). It resolves automatically once the CSS rebuild completes. Not a production issue — fresh page loads work correctly.
