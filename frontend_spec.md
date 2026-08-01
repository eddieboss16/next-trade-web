# Frontend Spec — next-trade-web

**Repo:** `next-trade-web` (new, third repo — separate from `next-trade-engine` and `next-trade-api`)
**Scope:** the actual clickable product. Everything built so far (Weeks 1–3) is invisible without this — nothing has a UI yet.

## Stack — decided, do not re-litigate

- **Vite + React + TypeScript.** No Next.js — this is a client-only SPA, no SSR need.
- **`lightweight-charts`** for the candlestick chart — matches the original architecture decision.
- **Native `WebSocket`**, no socket.io — the engine's WS server is plain `ws`.
- **`fetch` with `credentials: 'include'`** against Laravel — Sanctum SPA/cookie auth, never a bearer token.
- **Tailwind CSS** for styling.
- **React Router** for client-side routing (login, dashboard/trading view, account view).
- State: React Context + hooks. No Redux/Zustand — the state surface here doesn't justify it.

## Hard boundaries

- No server-side rendering, no meta-framework.
- No bearer-token storage anywhere (`localStorage`, etc.) — cookie auth only, per the already-built backend contract.
- No new backend logic. This repo consumes `next-trade-api` and `next-trade-engine`'s existing, tested contracts — it does not reimplement validation, margin checks, or order logic client-side beyond basic form UX (e.g. disabling a submit button on an obviously invalid quantity is fine; re-deriving margin math in the browser is not).
- Price-feed redistribution restriction still applies, inherited from the engine's `CLAUDE.md`: this app is not deployed behind a public URL until the Twelve Data ToS confirmation lands. Screen-share/local-dev use only until then.

## The one gotcha to get right immediately

Sanctum's SPA auth requires priming a CSRF cookie **before** the first login attempt:

```
GET /sanctum/csrf-cookie   (credentials: 'include')
→ then POST /api/login
```

Skipping this produces a `419` that looks like a broken login rather than a missing setup step. Build this into the API client's login flow from the start, not as a fix after hitting the error.

## API contracts being consumed (already built and tested — reference, don't reinvent)

- `POST /api/login`, `POST /api/logout`, `GET /api/user` — Sanctum SPA auth.
- `GET /api/accounts/{id}` — live balance/equity/margin. Handle `503` explicitly (no price available for an open position) — this is a real, tested backend state, not an edge case to ignore.
- `POST /api/orders` — the full status contract already documented in `next-trade-api`'s `CLAUDE.md` (201 accepted, 200 idempotent replay, 422 margin/validation/engine-rejected, 409 duplicate, 502 engine unreachable). **The frontend must handle every one of these distinctly** — collapsing them into a generic "something went wrong" throws away information the backend went through real effort to provide.
- `DELETE /api/orders/{id}` — cancel, same status contract discipline.
- `GET /api/orders` — order history.
- `WS /stream/:instrumentId` (engine, port 8080 in dev) — `candle_history`, `candle`, `candle_closed`, trade prints, depth snapshots, per the engine's Week 2–3 work.

## §1 — Project setup + auth screens

- Vite scaffold, Tailwind configured, API client module wrapping `fetch` with the CSRF-priming flow built in.
- Login screen, logout action, a route guard that redirects unauthenticated users to login.
- Required test: an unauthenticated user hitting a protected route is redirected, not shown a broken/empty page.

## §2 — Live trading view

- Candlestick chart via `lightweight-charts`, fed by the WS `candle_history`/`candle`/`candle_closed` messages.
- Live order book depth display, fed by the existing depth-snapshot broadcast.
- **Gap handling is required, not optional** — this was explicitly flagged in the engine's `CLAUDE.md` as the frontend's responsibility: candle gaps are skipped upstream, never synthesized, so this view must render sensible gaps rather than assume continuous data.
- Required test: the chart correctly reflects a `candle_closed` event by finalizing the current candle and starting a new one — verified against a mocked WS message sequence, not a live connection.

## §3 — Order entry + execution feedback

- A form for submitting market/limit orders, calling `POST /api/orders`.
- **Every distinct status from the contract above must produce a distinct, legible UI response** — a margin rejection should not look like a generic error, an engine-unreachable 502 should not look like a validation failure. This is the single most important thing in this section: the backend did real work to distinguish these cases, and collapsing them here throws that work away.
- Order cancellation from an open-orders list, using the same distinct-status discipline.
- Required test: submitting an order that returns a 422 margin rejection displays a specific, correct message — not a generic failure state — verified against a mocked API response for each distinct status code in the contract table.

## §4 — Account view

- Displays balance/equity/used-margin/free-margin/margin-level from `GET /api/accounts/{id}`, live.
- Handles the `503` (no price available) state explicitly and legibly, not as a crash or blank screen.
- Order history list from `GET /api/orders`.

## Required tests (overall)

1. Unauthenticated access to a protected route redirects to login (§1).
2. Login flow correctly primes the CSRF cookie before submitting credentials (§1).
3. Chart correctly processes a mocked `candle_closed` WS event (§2).
4. The live view renders a visible gap rather than a false flat line when candle data has a gap (§2).
5. Each distinct `POST /api/orders` response status produces a distinct, correct UI state — test all seven documented outcomes, not just the success case (§3).
6. Order cancellation reflects the same distinct-status discipline (§3).
7. The `503` no-price-available account state renders legibly, not as a crash (§4).

## Acceptance criteria

- All required tests pass.
- No bearer tokens anywhere in the codebase — a grep for `localStorage` touching anything auth-related should return nothing.
- Every status code in the `/orders` contract table has a corresponding, visually distinct UI treatment — verified by inspection against the table, not assumed.
- The app runs against the real `next-trade-api` and `next-trade-engine` locally, end-to-end, with a real login → real order submission → real live chart update, confirmed by the human — same standard as every prior phase, not just passing tests in isolation.

If Fable 5 or Opus proposes adding client-side margin/order-matching logic, a state management library, or a meta-framework because "it would scale better" — that's the same scope-creep pattern flagged every phase so far. This is a demo SPA consuming two already-correct backends; push back on anything that duplicates logic those backends already own correctly.
