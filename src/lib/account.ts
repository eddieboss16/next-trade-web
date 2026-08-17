/**
 * `GET /api/accounts/{id}` — the account's live money view.
 *
 * Same discipline as orders.ts: a discriminated union, not exceptions, because
 * the documented responses are outcomes rather than failures. The `503` in
 * particular is a REAL, TESTED backend state (`MissingPriceException`): the
 * account holds an open position in an instrument with no current price, so
 * equity cannot honestly be marked to market. The backend fails loudly instead
 * of pretending the price is zero — so the frontend must say so, not crash and
 * not blank the screen.
 *
 * MONEY IS INTEGER CENTS (`AccountMetrics` in the API: "integers in the
 * account's smallest money unit"). `margin_level_pct` is the one float, and it
 * is NULL when used margin is 0 — no open positions means the margin level is
 * effectively infinite, which is not the same as 0%.
 */

import { apiRequest } from './api'
import { config } from './config'

export interface Account {
  id: string
  name: string
  /** Integer cents. */
  balance: number
  equity: number
  used_margin: number
  free_margin: number
  /** Percent, or null when there are no open positions. */
  margin_level_pct: number | null
}

export type AccountOutcome =
  | { kind: 'ok'; account: Account }
  /** 503 — an open position has no current price; equity cannot be computed. */
  | { kind: 'price_unavailable'; message: string }
  /** 403 — the account belongs to someone else. */
  | { kind: 'forbidden'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'unexpected'; status: number; message: string }

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function messageOf(body: Record<string, unknown>, fallback: string): string {
  return typeof body.message === 'string' && body.message ? body.message : fallback
}

export async function fetchAccount(accountId: string): Promise<AccountOutcome> {
  let response: Response
  try {
    response = await apiRequest(`/api/accounts/${encodeURIComponent(accountId)}`)
  } catch {
    return {
      kind: 'unreachable',
      message: 'Could not reach the API to load your account.',
    }
  }

  const body = await readBody(response)

  switch (response.status) {
    case 200:
      return { kind: 'ok', account: body as unknown as Account }

    case 503:
      return {
        kind: 'price_unavailable',
        message: messageOf(
          body,
          'Cannot compute margin/equity: no current price for an instrument.',
        ),
      }

    case 403:
      return { kind: 'forbidden', message: messageOf(body, 'That account is not yours.') }

    case 404:
      return { kind: 'not_found', message: messageOf(body, 'Account not found.') }

    case 401:
      return { kind: 'unauthenticated', message: messageOf(body, 'Your session has expired.') }

    default:
      return {
        kind: 'unexpected',
        status: response.status,
        message: messageOf(body, `Unexpected response (${response.status}).`),
      }
  }
}

/** Integer cents → a grouped decimal string. No currency symbol is invented. */
export function formatMoney(cents: number, moneyScale = config.moneyScale): string {
  return (cents / 10 ** moneyScale).toLocaleString(undefined, {
    minimumFractionDigits: moneyScale,
    maximumFractionDigits: moneyScale,
  })
}

/** Margin level for display. Null (no open positions) is NOT 0%. */
export function formatMarginLevel(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(2)}%`
}
