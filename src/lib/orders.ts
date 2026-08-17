/**
 * Order intake, cancel and history against `next-trade-api`.
 *
 * THE DESIGN POINT OF THIS FILE: every documented response is a distinct,
 * meaningful OUTCOME, not an "error". So these functions return a discriminated
 * union instead of throwing — the caller is forced by the type system to say
 * what each outcome looks like, and there is no `catch` block for distinct
 * backend states to quietly collapse into.
 *
 * This is why `apiRequest` returns the raw `Response`: status is data here, not
 * a failure signal.
 *
 * Status alone is NOT enough to discriminate. Transcribed from
 * `OrderController@store`, the overloads are:
 *   422 → validation errors | insufficient_margin | engine rejection
 *   409 → duplicate id at the engine | no account / id already in use
 * Both are separated by the response body, not the status code.
 */

import { apiRequest, ensureCsrfCookie } from './api'

export type OrderSide = 'buy' | 'sell'
export type OrderType = 'limit' | 'market'

export type OrderStatus =
  | 'pending'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'

/** The `payload()` shape from OrderController — snake_case, straight from the API. */
export interface Order {
  id: string
  instrument_id: string
  account_id: string
  side: OrderSide
  type: OrderType
  /** Integer, smallest price unit. Null for market orders. */
  price: number | null
  quantity: number
  filled_quantity: number
  status: OrderStatus
  sequence: number
  created_at: string
  updated_at: string
}

export interface NewOrder {
  /** Caller-owned UUID idempotency key. Makes a double-submit a 200 replay. */
  id: string
  instrument_id: string
  side: OrderSide
  type: OrderType
  /** Integer smallest unit. Required for limit, PROHIBITED for market. */
  price?: number
  quantity: number
}

export type SubmitOutcome =
  /** 201 — engine accepted it: resting, filled, or partially filled. */
  | { kind: 'accepted'; order: Order }
  /** 200 — this id was already stored; returned unchanged, engine NOT called. */
  | { kind: 'replayed'; order: Order }
  /** 422 `reason: insufficient_margin` — rejected at intake, engine NOT called. */
  | {
      kind: 'insufficient_margin'
      projectedMarginLevelPct: number | null
      requiredMinPct: number | null
      message: string
    }
  /** 422 with an engine `reason` — the engine itself rejected it. */
  | { kind: 'engine_rejected'; reason: string; orderId: string | null; message: string }
  /** 422 with Laravel validation errors — the payload never left the browser's edge. */
  | { kind: 'invalid'; errors: Record<string, string[]>; message: string }
  /** 409 `reason: duplicate` — the engine already knows this id. */
  | { kind: 'duplicate'; orderId: string | null; message: string }
  /** 409 "No trading account for this user." — nothing can be submitted at all. */
  | { kind: 'no_account'; message: string }
  /** 409 "Order id already in use." — that id belongs to another account. */
  | { kind: 'order_id_in_use'; message: string }
  /** 409 that matches none of the above — never dressed up as one that does. */
  | { kind: 'conflict'; message: string }
  /** 502 — engine unreachable. The order is SAVED AS PENDING and not resubmitted. */
  | { kind: 'engine_unavailable'; orderId: string | null; message: string }
  /** 503 — no price for the instrument, so margin could not be checked. */
  | { kind: 'price_unavailable'; message: string }
  /** 401 — session gone. */
  | { kind: 'unauthenticated'; message: string }
  /** Anything undocumented. Deliberately its own kind so it can never pose as a known one. */
  | { kind: 'unexpected'; status: number; message: string }

export type CancelOutcome =
  /** 200 — cancelled; the returned order carries the engine's terminal state. */
  | { kind: 'cancelled'; order: Order }
  /** 403 — not the caller's order. The engine was never contacted. */
  | { kind: 'forbidden'; message: string }
  /** 409 — unknown to the engine or no longer resting. */
  | { kind: 'not_cancellable'; orderId: string | null; message: string }
  /** 502 — engine unreachable; the order is UNCHANGED, the cancel did not happen. */
  | { kind: 'engine_unavailable'; orderId: string | null; message: string }
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'unexpected'; status: number; message: string }

interface ErrorBody {
  message?: unknown
  reason?: unknown
  order_id?: unknown
  errors?: unknown
  projected_margin_level_pct?: unknown
  required_min_pct?: unknown
}

async function readBody(response: Response): Promise<ErrorBody & Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as ErrorBody & Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function messageOf(body: ErrorBody, fallback: string): string {
  return typeof body.message === 'string' && body.message ? body.message : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function validationErrorsOf(body: ErrorBody): Record<string, string[]> | null {
  if (typeof body.errors !== 'object' || body.errors === null) return null
  const entries = Object.entries(body.errors as Record<string, unknown>)
  if (entries.length === 0) return null

  const errors: Record<string, string[]> = {}
  for (const [field, messages] of entries) {
    if (Array.isArray(messages)) {
      errors[field] = messages.map(String)
    } else if (typeof messages === 'string') {
      errors[field] = [messages]
    }
  }
  return Object.keys(errors).length > 0 ? errors : null
}

export async function submitOrder(input: NewOrder): Promise<SubmitOutcome> {
  await ensureCsrfCookie()

  const response = await apiRequest('/api/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const body = await readBody(response)

  switch (response.status) {
    case 201:
      return { kind: 'accepted', order: body as unknown as Order }

    case 200:
      return { kind: 'replayed', order: body as unknown as Order }

    case 422: {
      // Three different outcomes share this status — separate them on the body.
      // Validation errors are checked FIRST: a payload that never reached the
      // margin check or the engine is a different story from either of those.
      const errors = validationErrorsOf(body)
      if (errors) {
        return {
          kind: 'invalid',
          errors,
          message: messageOf(body, 'The order was not valid.'),
        }
      }

      if (body.reason === 'insufficient_margin') {
        return {
          kind: 'insufficient_margin',
          projectedMarginLevelPct: numberOrNull(body.projected_margin_level_pct),
          requiredMinPct: numberOrNull(body.required_min_pct),
          message: messageOf(
            body,
            'Order rejected: would breach the minimum margin level.',
          ),
        }
      }

      return {
        kind: 'engine_rejected',
        reason: stringOrNull(body.reason) ?? 'rejected',
        orderId: stringOrNull(body.order_id),
        message: messageOf(body, 'Order rejected by the engine.'),
      }
    }

    case 409: {
      // THREE outcomes share this status. Only the engine's duplicate-id
      // rejection carries a `reason`; the other two are separated by their
      // message alone (OrderController@store: one `response()->json`, one
      // `abort_unless(..., 409, 'Order id already in use.')`).
      if (body.reason === 'duplicate') {
        return {
          kind: 'duplicate',
          orderId: stringOrNull(body.order_id),
          message: messageOf(body, 'Order rejected: duplicate order id.'),
        }
      }

      const message = messageOf(body, 'Order could not be placed.')

      // Matched on a distinctive substring rather than the exact string, so
      // trivial rewording upstream degrades to `conflict` instead of silently
      // mislabelling one case as the other.
      if (/no trading account/i.test(message)) {
        return { kind: 'no_account', message }
      }
      if (/order id already in use/i.test(message)) {
        return { kind: 'order_id_in_use', message }
      }

      return { kind: 'conflict', message }
    }

    case 502:
      return {
        kind: 'engine_unavailable',
        orderId: stringOrNull(body.order_id),
        message: messageOf(
          body,
          'Trading engine is unavailable; your order is saved as pending and was not submitted.',
        ),
      }

    case 503:
      return {
        kind: 'price_unavailable',
        message: messageOf(
          body,
          'No price is available for this instrument, so margin could not be checked.',
        ),
      }

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

export async function cancelOrder(orderId: string): Promise<CancelOutcome> {
  await ensureCsrfCookie()

  const response = await apiRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
  })
  const body = await readBody(response)

  switch (response.status) {
    case 200:
      return { kind: 'cancelled', order: body as unknown as Order }

    case 403:
      return { kind: 'forbidden', message: messageOf(body, 'That order is not yours to cancel.') }

    case 409:
      return {
        kind: 'not_cancellable',
        orderId: stringOrNull(body.order_id),
        message: messageOf(
          body,
          'Order is not cancellable (unknown to the engine or no longer resting).',
        ),
      }

    case 502:
      return {
        kind: 'engine_unavailable',
        orderId: stringOrNull(body.order_id),
        message: messageOf(
          body,
          'Trading engine is unavailable; the order was not cancelled.',
        ),
      }

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

/** GET /api/orders — history for the authenticated account, newest first. */
export async function fetchOrders(): Promise<Order[]> {
  const response = await apiRequest('/api/orders')
  if (!response.ok) return []
  const body = await readBody(response)
  return Array.isArray(body) ? (body as unknown as Order[]) : []
}

/** Orders the API will let you cancel — anything still working in the book. */
export function isCancellable(order: Order): boolean {
  return (
    order.status === 'open' ||
    order.status === 'partially_filled' ||
    order.status === 'pending'
  )
}
