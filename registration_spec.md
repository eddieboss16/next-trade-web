# Registration Spec

**Repos:** `next-trade-api` (endpoint) + `next-trade-web` (sign-up screen) — a small, tightly coupled feature, spec'd together since one is meaningless without the other.

**Why this matters now:** every account in this system so far exists only because a seeder was run manually. Nobody outside this project — no broker, no evaluator — can currently create their own login. This is the actual blocker on the original goal.

## Scope

A user can create their own account: email, password, gets a linked trading account with the standard starting balance, and lands on the dashboard already logged in — same as login's end state.

## Explicitly out of scope for v1 — do not let these creep in

- Email verification.
- Password reset / forgot-password flow. This is a real, known gap — a demo user who forgets their password has no self-service recovery in v1. Document it, don't quietly build around it.
- OAuth/social login.
- Multi-account support — one account per user, same as everywhere else in this system.

## API side (`next-trade-api`)

- `POST /api/register` — `email`, `password`, `password_confirmation` (standard Laravel convention), a display `name`.
- On success: create the `User`, create a linked `Account` with `starting_balance_cents` at its schema default (same `$10,000` value already used everywhere else), establish a real session (log the user in via the same guard login uses), and return the user object in the same shape `GET /api/user` already returns — including `account_id`, so the frontend doesn't need a separate lookup after registering, consistent with the `account_id` work already shipped.
- Duplicate email → Laravel's standard unique-validation `422`, with the same `errors`-keyed body shape already used elsewhere — no custom handling needed, this is exactly what the framework already does correctly.
- **Rate-limited, same as login.** Unrestricted registration is a real abuse vector (account-creation spam) even for a demo system — this needs the same discipline already applied to `/api/login`, not an oversight.
- CSRF priming applies here too — this is a state-changing `POST`, same requirement as login.

## Frontend side (`next-trade-web`)

- A sign-up screen, with a link to/from the login screen ("New here? Register" / "Already have an account? Sign in").
- The API client's `register()` function primes the CSRF cookie itself, same pattern as `login()` — no separate step to remember.
- On success: same redirect-to-dashboard behavior as a successful login.
- Duplicate-email and validation errors get distinct, legible messages — not a generic failure, same discrimination discipline already applied to every other form in this app.

## Required tests

**API:**
1. Successful registration creates a `User` and a correctly linked `Account` with the standard starting balance.
2. Duplicate email is rejected with `422`, and no duplicate `User`/`Account` rows are created.
3. Registration establishes a real session — a subsequent `GET /api/user` call, using the same session, is authenticated and returns the new user's data including `account_id`.
4. Rate limiting is actually enforced — confirm this with a real test, not just wired-and-assumed, same standard as everything else in this project.

**Frontend:**
5. Successful registration navigates to the dashboard, same as login.
6. A duplicate-email response renders a specific, legible message — not the generic error state.

## Acceptance criteria

- All required tests pass on both repos.
- A genuinely new browser session, with no seeded data and no manual `tinker` intervention, can register, land on the dashboard, and place an order — the complete loop, proven the same way login → order → fill was proven, not assumed from unit tests alone.
