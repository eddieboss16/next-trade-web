# CLAUDE.md — next-trade-web

Client-only SPA (Vite + React + TS) consuming `next-trade-api` (Laravel/Sanctum)
and `next-trade-engine` (plain `ws`). See [frontend_spec.md](frontend_spec.md) for
scope. This file records conventions that are easy to break silently.

## Hosts: always `localhost`, never `127.0.0.1`

**The API base URL is `http://localhost:8000`, and the dev server is served from
`http://localhost:5173`. Never `127.0.0.1` on either side.**

Cookies are host-scoped, and the browser treats `localhost` and `127.0.0.1` as
two different hosts even though they resolve to the same machine. Mixing them
means Sanctum sets the session cookie on one host and the browser never sends it
back to the other — auth silently fails with no error that points at the cause.
The same applies to the engine's WebSocket (`ws://localhost:8080`).

This is not a preference. If you find yourself typing `127.0.0.1`, stop.

Enforced in three places:

- [src/lib/api.ts](src/lib/api.ts) — `DEFAULT_API_BASE_URL`, plus a dev-only
  `console.warn` when the API host and `window.location.hostname` differ.
- [vite.config.ts](vite.config.ts) — `server.host: 'localhost'`, `strictPort`.
- [src/lib/api.test.ts](src/lib/api.test.ts) — asserts the base URL's hostname.

Laravel's side must agree: `SANCTUM_STATEFUL_DOMAINS=localhost:5173`,
`SESSION_DOMAIN=localhost`, and the CORS allowed origin `http://localhost:5173`
with `supports_credentials` on.

## CSRF priming is part of `login()`, not a step callers remember

Sanctum requires `GET /sanctum/csrf-cookie` before the first `POST /api/login`,
or Laravel answers `419` — which reads like a broken login rather than missing
setup. `login()` in [src/lib/api.ts](src/lib/api.ts) performs the prime itself,
unconditionally, before the credentials POST. Do not factor it back out into a
separate call site; the ordering is covered by a test.

Mutating requests other than login use `ensureCsrfCookie()`, which primes only
when the `XSRF-TOKEN` cookie is absent.

## Auth is cookie-only

No bearer tokens, no `localStorage`, no `sessionStorage` — anywhere, for
anything auth-related. Every request goes through `apiRequest()`, which sets
`credentials: 'include'` and forwards the `XSRF-TOKEN` cookie as the
`X-XSRF-TOKEN` header. A test asserts `localStorage.setItem` is never called
during login.

## Registration ends authenticated, and its 422 carries three stories

`POST /api/register` answers **201** — not login's 200 — creates the linked
trading account at the schema-default starting balance, and establishes the
session on the same guard login uses. So `register()` in
[src/lib/api.ts](src/lib/api.ts) needs no follow-up login round-trip: the user it
returns already carries `account_id`, and `AuthProvider` goes straight to
`authenticated`. Like `login()`, it primes the CSRF cookie itself
(unconditionally, before the POST) rather than leaving it to the caller.

The API rate-limits registration **by IP alone**, deliberately unlike login's
email+IP: sign-up spam varies the email every attempt, so keying on it would let
an attacker sidestep the limit entirely.

That limit surfaces as a `422` on the `email` field — the *same field* a
duplicate email uses. So `422` here carries three different outcomes separated
only by the body, and `describeRegisterFailure` in
[src/pages/RegisterPage.tsx](src/pages/RegisterPage.tsx) discriminates them:

| Body | Outcome | Treatment |
|---|---|---|
| `errors.email` matches `/already been taken/i` | duplicate email | own copy **+ a "Sign in instead" link** |
| `errors.email` matches `/too many/i` | IP rate limit | the API's own message, with its countdown |
| any other `errors` | ordinary validation | first field message |

Matched on a distinctive **substring**, never the exact string — upstream
rewording degrades to the generic validation message rather than silently
mislabelling one case as the other. A duplicate email is not a "try again"
failure, which is why it is the one case that gets an escape route rather than a
red box; a test asserts the other two do *not* render that link, so "distinct"
is pinned rather than assumed.

### Known gap: no password reset

There is **no self-service password recovery** — out of scope for v1 per
[registration_spec.md](registration_spec.md), recorded here rather than papered
over. A demo user who forgets their password needs manual intervention
(`DemoUserSeeder` re-run, or a `tinker` reset). Do not build a partial
forgot-password flow to close this; it needs its own spec (mail transport, signed
token expiry, rate limiting).

## Prices are integers; the chart needs a scale to render them

The engine is integers-only end to end (`feed/types.ts`): `"150.25"` at
`priceScale` 2 is broadcast as `15025`, and candle O/H/L/C, depth levels and
trade prints are all in the smallest price unit. Timestamps (`openTime`,
`timestamp`) are epoch **milliseconds**.

`lightweight-charts` wants decimals and epoch **seconds**. Both conversions live
in [src/lib/chartData.ts](src/lib/chartData.ts) and nowhere else. The
milliseconds→seconds one has no error mode — get it wrong and every candle
silently renders in 1970.

### Scales come from the API, never from local config

`GET /api/instruments` (public, no auth, active *and* inactive rows) is the
single source of truth for `price_scale` and `quantity_scale`.
[src/lib/instruments.ts](src/lib/instruments.ts) fetches it;
[InstrumentsProvider](src/instruments/InstrumentsProvider.tsx) loads it once per
app, in parallel with the session check.

There is deliberately **no local fallback scale and no default instrument**. A
wrong scale renders every price off by a power of ten with no error, so the UI
waits (`Loading instruments…`) or shows a retryable error instead of guessing.
A row whose scales are not JSON integers is skipped and logged rather than
becoming `NaN` downstream. Do not reintroduce an env mirror of this data.

Each order row in the history is formatted with **its own** instrument's scales,
looked up by `order.instrument_id` — not the currently-selected instrument's,
which would misprice every row belonging to a different instrument.

## Candle gaps: whitespace, never synthesized candles

The engine's aggregator emits no candle for a bucket with no ticks and never
fabricates flat placeholders; its `CLAUDE.md` names the frontend as responsible
for "rendering sensible gaps". `toChartData` inserts lightweight-charts
*whitespace* points (`{ time }`, no OHLC) for skipped buckets: they hold a slot
on the time scale and draw nothing, so the break is visible.

Do not "fix" a gap by filling it with flat OHLC candles. A whitespace point
asserts "no data here", which is what the engine recorded; a flat candle asserts
a price nobody observed. Long gaps (a weekend is ~2,880 empty 1-minute buckets)
are capped so the real candles stay readable — the gap is visible, not to scale.

## Account view: money is cents, and null margin level is not 0%

`GET /api/accounts/{id}` returns money as **integers in the smallest money unit**
(`AccountMetrics`), so `1_025_050` renders `10,250.50`. `margin_level_pct` is the
one float and is **null when used margin is 0** — no open positions, i.e. the
*healthiest* state. Rendering null as `0%` would make it read as the worst one;
it renders `—` with "No open positions".

The `503` is a real, tested backend state (`MissingPriceException`): an open
position exists in an instrument with no current price, so equity cannot be
honestly marked to market. The backend fails loudly instead of treating the
missing price as zero, and the frontend does the same — a named panel explaining
why, never a crash, a blank, or a fabricated 0.00. If figures were already on
screen when a poll degrades to 503, they stay, explicitly labelled as possibly
out of date.

Balance/equity/margin are computed live per request and never cached
server-side, so "live" means polling (`VITE_ACCOUNT_POLL_MS`, default 5s).

### The account id comes from the user payload

The API appends `account_id` to the serialized user (`#[Appends]` on the User
model), so it arrives on both `GET /api/user` and the login response.
[AccountPage](src/pages/AccountPage.tsx) reads `user.account_id` directly — no
lookup, no env override, no derivation from order history.

`null` is a real state (no account linked), not a failed lookup, and gets its
own message rather than an empty money panel.

## Tunables live in config.ts, never as call-site literals

[src/lib/config.ts](src/lib/config.ts) is this repo's counterpart to the API's
`config/trading.php`, and holds to the same standard: every default is a
documented decision with an env override (`VITE_MAX_GAP_SLOTS`,
`VITE_CANDLE_HISTORY_LIMIT`, …). Do not silently hardcode one of these numbers
at a call site.

Nothing in there is a market rule. Leverage, margin levels and order validation
belong to the backends and are not mirrored or re-derived here — these are
presentation and buffering choices only.

## Stream state is a pure reducer

[src/lib/streamState.ts](src/lib/streamState.ts) is socket-free: everything
deciding what the chart shows is `(state, message) => state`, mirroring the
engine's own split between the pure `candleAggregator` and the stateful
`candleService`. `useInstrumentStream` is the thin shell that owns the socket.
This is what lets the required tests replay a real engine message sequence with
no live connection.

On `candle_closed` the reducer clears `inProgress` for that bucket. The engine
sends `candle_closed` then immediately `candle` for the new bucket; leaving the
old one live double-draws it in the window between the two frames.

## Status contracts are not collapsed into "something went wrong"

`POST /api/orders` and `DELETE /api/orders/{id}` have documented per-status
meanings, and `GET /api/accounts/{id}` has a real `503` state. Each gets a
distinct, legible UI treatment. `apiRequest()` returns the raw `Response`
precisely so callers can switch on status; `apiJson()` (which throws `ApiError`
carrying `.status`) is for endpoints without such a contract.

**Status alone does not identify the outcome, and there are 13 of them, not
seven.** [frontend_spec.md](frontend_spec.md) §3 says "all seven documented
outcomes"; that is an undercount, and building to it would have merged real
cases. The counts the code actually switches on, transcribed from
`OrderController@store` and `@destroy` (the source of truth — not the spec
summary, and not the API's own contract table, which omits the second 409):

**`POST /api/orders` — 13 outcomes across 8 statuses**

| Status | Outcome | Distinguished by |
|---|---|---|
| 201 | accepted: `open` / `filled` / `partially_filled` | `order.status` (3 distinct UI states) |
| 200 | idempotent replay | — |
| 422 | payload invalid | body has `errors` |
| 422 | insufficient margin | `reason: insufficient_margin` |
| 422 | engine rejected | any other `reason` |
| 409 | duplicate id at the engine | `reason: duplicate` |
| 409 | no trading account for this user | no `reason`, message matches `/no trading account/i` |
| 409 | order id already in use (another account's) | no `reason`, message matches `/order id already in use/i` |
| 409 | anything else | falls to `conflict` — never dressed up as one of the above |
| 502 | engine unreachable, row left `pending` | — |
| 503 | price unavailable, margin uncheckable | — |
| 401 | unauthenticated | — |
| — | undocumented status | falls to `unexpected`, never posing as a known outcome |

**`DELETE /api/orders/{id}` — 6 outcomes:** 200 cancelled · 403 not owner
(engine never contacted) · 409 not cancellable · 502 engine unreachable (order
unchanged) · 401 unauthenticated · `unexpected`.

The two overloaded statuses are the trap: **422 carries three different stories
and 409 carries four**, separated only by the response body. Order matters —
validation `errors` is checked before `reason`, because a payload that never
reached the margin check is a different story from one the engine refused.

Only the engine's duplicate-id 409 carries a `reason`; the other two are told
apart by their **message text**, matched on a distinctive substring rather than
the exact string, so upstream rewording degrades to `conflict` instead of
silently mislabelling one case as the other.

[src/lib/orders.ts](src/lib/orders.ts) returns a discriminated union instead of
throwing, because every documented response is a meaningful outcome rather than
an error — the type system then forces a UI decision for each. Validation errors
are checked before `reason`, since a payload that never reached the margin check
is a different story from one the engine refused.

[src/lib/orderFeedback.ts](src/lib/orderFeedback.ts) maps outcome → copy, kept
pure so "every outcome produces a distinct state" is asserted exhaustively over
the union rather than by rendering 13 forms.

### The 502 is the one that matters most

An engine-unreachable submit is **not** a rejection: the order was persisted as
`pending` and simply never reached the engine. Rendering it as a generic failure
invites a resubmit that creates a SECOND order. The copy says so explicitly, and
a test pins it. Same for cancel: a 502 leaves the order unchanged and still
working.

### Idempotency key — keyed to the ticket's CONTENTS

The ticket sends a caller-owned UUID (`id`). Laravel's guard is
`Order::find($id)`: same id → 200 replay, engine not called, no second row. The
key is therefore tied to the ticket's contents, via a signature over
`(instrument, side, type, price, quantity)`:

| Situation | Key | Why |
|---|---|---|
| Identical ticket resubmitted | **reuse** | double-click, or a retry after a 502, replays instead of inserting a second row |
| Ticket edited | **mint** | a different quantity/price is a different order; reusing would replay the old one and silently discard the new values |
| After a stored terminal outcome (accepted / replayed / duplicate / engine-rejected) | **clear** | that request is finished; a deliberate identical repeat is allowed to be a second order |
| After `order_id_in_use` (409) | **clear** | that id belongs to another account and can never succeed here; keeping it would make every retry hit the same conflict |

**The 502 case is the one that matters, and it must NOT rotate.** The row exists
as `pending`. If the key rotated there, a user who ignores the warning and hits
submit again would insert a *second* pending order — the warning copy would be
the only thing preventing it. Keeping the key makes the guard structural: the
resubmit replays. This was a real bug, caught by writing the case down; the
regression test is `REUSES the key after a 502…` in `OrderTicket.test.tsx`, and
the 502 hint copy is worded to match the actual behaviour.

## Quantity is unscaled; price is not

The API takes `quantity` as a plain integer and `price` as an integer in the
smallest unit, so the ticket converts the typed decimal price (150.25 → 15025)
but passes quantity through. Market orders must OMIT `price` entirely — the
validator *prohibits* the field rather than ignoring it.

The limit-price input is `type="text"` + `inputMode="decimal"` on purpose: a
controlled `type="number"` input reports the intermediate `"150."` as an empty
value, which mangles any decimal a user types.

## Commands

```
npm run dev        # vite, http://localhost:5173
npm test           # vitest run
npm run typecheck  # tsc -b
npm run lint       # oxlint
```

### `src/test/setup.ts` must stay synchronous

Two rewrites of this file have taken the whole suite down, both trying to skip
the DOM imports for the `@vitest-environment node` suites:

- A top-level `await import(...)` placed **before** `afterEach(...)` defers hook
  registration past Vitest's setup window. Every file then fails with
  `Cannot read properties of undefined (reading 'config')` — 15 files, zero
  tests collected.
- Making `afterEach` async lets the next test start rendering before
  `cleanup()` finishes. That surfaces as *interleaved input from two tests*
  (`"wrong"` + `"secret"` → `"wsreocnrget"`), which reads like an app bug.

The guard was unnecessary anyway: the node-environment suites import this file
as-is without complaint (verified by running them directly, not assumed).

### Timeouts are raised because the machine is slow, not to hide failures

Three defaults are too tight here and all three produced misleading failures:

| Setting | Default | Here | Why |
|---|---|---|---|
| `testTimeout` | 5s | 20s | jsdom setup alone runs 130-260s across the suite |
| `hookTimeout` | 10s | 30s | same |
| RTL `asyncUtilTimeout` | 1s | 5s | an initial render has been seen not to commit within 1s under load, so `findBy*` fails against a still-empty container |

A timed-out test does not fail cleanly — it keeps typing into the shared
document and corrupts the *next* test, so the visible failure points somewhere
innocent. Raising the limits is headroom; a genuinely broken test still fails.
This is not `--retry`, which would hide real failures.

⚠ Worker-level crashes (`Worker exited unexpectedly`, `Failed to start … worker`)
still happen occasionally under host contention. They fail LOUD and empty — no
test counts at all — so they cannot produce a false green. Re-run.

### Worker startup is the constraint, and `isolate: false` is why it works

The default `forks` pool never starts workers on this machine at all, and even
`threads` starts can exceed Vitest's **hard-coded, non-configurable 60s**
`START_TIMEOUT`. What matters is the NUMBER of worker starts:

- `isolate: true` (default) restarts a worker per test file — 15 files, 15
  starts. This began failing *consistently* as the suite grew past ~14 files.
- `isolate: false` reuses workers, so starts drop to `maxWorkers` (4) no matter
  how many files exist. 15/15 files, ~22s, and four consecutive clean runs.

Lowering `maxWorkers` does **not** help — measured, not assumed: at
`maxWorkers: 2` the suite still failed 8 worker starts and took 302s. It
serializes the same number of starts rather than reducing them.

⚠ **The trade-off:** files sharing a worker share a module registry, so
module-level state and `vi.mock` can leak between test files. Install and tear
down per test (`vi.stubGlobal` / `vi.unstubAllGlobals`, as every suite here
does), and treat "passes only in a certain file order" as a real bug.

Two independent checks back this, because the mutation checks alone only prove
specific paths, not the absence of order-dependence:

1. **Mutation checks re-run under `isolate: false`** (503 branch, margin-422
   discrimination, gap whitespace) still failed 11 tests across 7 files — the
   suite has not gone soft.
2. **`npm run test:order`** — every file in ONE shared registry
   (`--no-file-parallelism --maxWorkers=1`) with `--sequence.shuffle.files`.
   This is the maximal-leakage configuration. Run it after adding a test file
   that mocks a module or touches module-level state.

That second check earned its keep immediately: it found a real order-dependence
(see the chart stub below). Note that passing files to `vitest run` in a chosen
order does NOT control execution order — the sequencer re-sorts them. Use
`--sequence.shuffle.files --sequence.seed=N` to vary order for real.

### Never `vi.mock` a module that another test file imports

`vi.mock` is registered per test FILE, but with a shared registry the first
file to import a module wins. `lightweight-charts` was mocked only in
`TradingPage.test.tsx`, while three other suites import `CandleChart`
transitively — so whenever one of those loaded first, the REAL library was
cached and the chart assertions silently received no data. It passed only
because of which worker each file happened to land on.

The fix is a bundler-level `test.alias` to
[src/test/chartStub.ts](src/test/chartStub.ts), resolved once for the whole run
and therefore order-independent. Prefer an alias over `vi.mock` for any module
imported by more than one suite.

The pure-logic suites additionally opt into `@vitest-environment node` to skip a
jsdom they don't use.

If you still see `Failed to start threads worker`, it fails LOUD and empty
(`Tests no tests`) — it cannot produce a green run that hides a real failure.
Re-run; if it persists, suspect host contention. Do NOT "fix" it with
`--retry`, which would hide genuine failures too.

`lightweight-charts` needs a canvas jsdom lacks, so component tests mock the
module and assert on the data handed to the series — which is the real contract
anyway.

## Scope discipline

No client-side margin or order-matching logic, no state library, no
meta-framework. Both backends are already correct and tested; this repo consumes
them. Price-feed redistribution restriction is inherited from the engine: local
/ screen-share use only until the Twelve Data ToS confirmation lands.
