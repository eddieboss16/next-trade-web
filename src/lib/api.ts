/**
 * API client for `next-trade-api` (Laravel + Sanctum SPA cookie auth).
 *
 * Two invariants live here because they are the kind that break silently:
 *
 * 1. The API host is `localhost`, never `127.0.0.1`. Cookies are host-scoped
 *    and the browser treats those two names as different hosts even though
 *    they resolve to the same machine — mixing them means the Sanctum session
 *    cookie is set on one host and never sent to the other, and auth just
 *    "doesn't work" with no error to point at. See CLAUDE.md.
 *
 * 2. `GET /sanctum/csrf-cookie` must be primed before the first mutating
 *    request or Laravel answers 419, which reads like a broken login rather
 *    than a missing setup step. `login()` primes it itself — no caller has to
 *    remember to do it first.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:8000'

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL

export interface User {
  id: number
  name: string
  email: string
  /**
   * The user's trading account id, appended by the API (`#[Appends]` on the
   * User model) to both `GET /api/user` and the login response. Null when no
   * account is linked yet — a real state, not a missing field.
   */
  account_id: string | null
}

export interface Credentials {
  email: string
  password: string
}

/**
 * Sign-up payload. `password_confirmation` is Laravel's standard `confirmed`-rule
 * convention and is sent under that exact snake_case name — the API validates the
 * pair, the client never compares them itself.
 */
export interface RegisterDetails {
  name: string
  email: string
  password: string
  password_confirmation: string
}

/** A non-2xx response from the API, carrying the status for callers to switch on. */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** Laravel 422 shape: `{ message, errors: { field: [msg, ...] } }`. */
export function validationErrors(error: unknown): Record<string, string[]> {
  if (!(error instanceof ApiError) || error.status !== 422) return {}
  const body = error.body as { errors?: Record<string, string[]> } | null
  return body?.errors ?? {}
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function warnOnHostMismatch(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  try {
    const apiHost = new URL(API_BASE_URL).hostname
    if (apiHost !== window.location.hostname) {
      console.warn(
        `[api] Host mismatch: the app is served from "${window.location.hostname}" but ` +
          `the API base URL is "${apiHost}". Session cookies are host-scoped, so ` +
          `Sanctum auth will fail silently. Use "localhost" on both sides.`,
      )
    }
  } catch {
    // A malformed base URL will surface on the first request anyway.
  }
}

warnOnHostMismatch()

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Low-level request. Always sends cookies, always asks for JSON, and attaches
 * the `X-XSRF-TOKEN` header Laravel expects when the CSRF cookie is present.
 * Returns the raw `Response` so callers can apply the per-endpoint status
 * contract themselves (see the `/api/orders` table in the spec).
 */
export async function apiRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('X-Requested-With', 'XMLHttpRequest')
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const xsrfToken = readCookie('XSRF-TOKEN')
  if (xsrfToken) headers.set('X-XSRF-TOKEN', xsrfToken)

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
}

/** Request + throw `ApiError` on non-2xx, for endpoints without a status contract. */
export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiRequest(path, init)
  const body = await parseBody(response)
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : undefined
    throw new ApiError(response.status, body, message)
  }
  return body as T
}

/** Fetches the CSRF cookie. Unconditional — call `ensureCsrfCookie` to skip when primed. */
export async function primeCsrfCookie(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/sanctum/csrf-cookie`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await parseBody(response),
      'Could not prime the CSRF cookie — is next-trade-api running on ' +
        `${API_BASE_URL}?`,
    )
  }
}

/** Primes the CSRF cookie only if one is not already set. */
export async function ensureCsrfCookie(): Promise<void> {
  if (readCookie('XSRF-TOKEN')) return
  await primeCsrfCookie()
}

/**
 * Logs in against Sanctum. The CSRF prime is part of this function by design:
 * it is a precondition of the POST, not a separate step a caller could forget.
 */
export async function login(credentials: Credentials): Promise<User> {
  await primeCsrfCookie()

  const body = await apiJson<User | { user?: User } | null>('/api/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })

  if (body && typeof body === 'object' && 'email' in body) return body as User
  if (body && typeof body === 'object' && 'user' in body && body.user) {
    return body.user
  }

  // Backend answered 204 / an envelope we don't recognise — read the session back.
  const user = await fetchCurrentUser()
  if (!user) {
    throw new ApiError(500, body, 'Login succeeded but no user session was returned.')
  }
  return user
}

/**
 * Registers a new user. The API answers **201** (not login's 200), creates the
 * linked trading account, and establishes the session on the same guard login
 * uses — so the end state here is identical to a successful login, and the
 * returned user already carries `account_id`.
 *
 * The CSRF prime is part of this function for the same reason it is part of
 * `login()`: it is a precondition of the POST, not a step a caller could forget.
 */
export async function register(details: RegisterDetails): Promise<User> {
  await primeCsrfCookie()

  const body = await apiJson<User | { user?: User } | null>('/api/register', {
    method: 'POST',
    body: JSON.stringify(details),
  })

  if (body && typeof body === 'object' && 'email' in body) return body as User
  if (body && typeof body === 'object' && 'user' in body && body.user) {
    return body.user
  }

  // Unrecognised envelope — the session exists regardless, so read it back
  // rather than failing a registration that actually succeeded.
  const user = await fetchCurrentUser()
  if (!user) {
    throw new ApiError(
      500,
      body,
      'Registration succeeded but no user session was returned.',
    )
  }
  return user
}

export async function logout(): Promise<void> {
  await ensureCsrfCookie()
  await apiJson<null>('/api/logout', { method: 'POST' })
}

/** Returns the authenticated user, or `null` when the session is absent/expired. */
export async function fetchCurrentUser(): Promise<User | null> {
  const response = await apiRequest('/api/user')
  if (response.status === 401 || response.status === 419) return null

  const body = await parseBody(response)
  if (!response.ok) throw new ApiError(response.status, body)
  return body as User
}
