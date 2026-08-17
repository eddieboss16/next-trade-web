import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelOrder, submitOrder, type Order } from './orders'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ORDER: Order = {
  id: '11111111-2222-3333-4444-555555555555',
  instrument_id: 'AAPL',
  account_id: 'acct-1',
  side: 'buy',
  type: 'limit',
  price: 15025,
  quantity: 10,
  filled_quantity: 0,
  status: 'open',
  sequence: 42,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const NEW_ORDER = {
  id: ORDER.id,
  instrument_id: 'AAPL',
  side: 'buy' as const,
  type: 'limit' as const,
  price: 15025,
  quantity: 10,
}

/** Answers the CSRF prime, then the order call with the given response. */
function respondWith(response: Response) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input)).pathname
    if (url === '/sanctum/csrf-cookie') {
      document.cookie = 'XSRF-TOKEN=csrf-token-value'
      return new Response(null, { status: 204 })
    }
    return response
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('submitOrder — every documented outcome is distinct', () => {
  it('201 → accepted, carrying the engine-confirmed order', async () => {
    respondWith(json({ ...ORDER, status: 'partially_filled', filled_quantity: 4 }, 201))
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') throw new Error('narrowing')
    expect(outcome.order.status).toBe('partially_filled')
    expect(outcome.order.sequence).toBe(42)
  })

  it('200 → replayed (idempotent), NOT confused with a fresh acceptance', async () => {
    respondWith(json(ORDER, 200))
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('replayed')
  })

  it('422 + reason:insufficient_margin → insufficient_margin, with the numbers', async () => {
    respondWith(
      json(
        {
          message: 'Order rejected: would breach the minimum margin level.',
          reason: 'insufficient_margin',
          projected_margin_level_pct: 87.5,
          required_min_pct: 100,
        },
        422,
      ),
    )
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('insufficient_margin')
    if (outcome.kind !== 'insufficient_margin') throw new Error('narrowing')
    expect(outcome.projectedMarginLevelPct).toBe(87.5)
    expect(outcome.requiredMinPct).toBe(100)
  })

  it('422 + an engine reason → engine_rejected, NOT a margin rejection', async () => {
    respondWith(
      json(
        {
          message: 'Order rejected by the engine.',
          reason: 'insufficient liquidity',
          order_id: ORDER.id,
        },
        422,
      ),
    )
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('engine_rejected')
    if (outcome.kind !== 'engine_rejected') throw new Error('narrowing')
    expect(outcome.reason).toBe('insufficient liquidity')
    expect(outcome.orderId).toBe(ORDER.id)
  })

  it('422 + validation errors → invalid, NOT an engine rejection', async () => {
    // All three 422s would collapse together if the body were ignored.
    respondWith(
      json(
        {
          message: 'The given data was invalid.',
          errors: { price: ['The price field is prohibited when type is market.'] },
        },
        422,
      ),
    )
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('invalid')
    if (outcome.kind !== 'invalid') throw new Error('narrowing')
    expect(outcome.errors.price[0]).toMatch(/prohibited/i)
  })

  it('409 + reason:duplicate → duplicate', async () => {
    respondWith(
      json(
        { message: 'Order rejected: duplicate order id at the engine.', reason: 'duplicate', order_id: ORDER.id },
        409,
      ),
    )
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('duplicate')
  })

  it('409 "No trading account" → no_account, NOT a duplicate', async () => {
    // Three outcomes share 409. Only the engine duplicate carries a `reason`;
    // these two are separated by their message alone.
    respondWith(json({ message: 'No trading account for this user.' }, 409))
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('no_account')
    if (outcome.kind !== 'no_account') throw new Error('narrowing')
    expect(outcome.message).toMatch(/no trading account/i)
  })

  it('409 "Order id already in use." → order_id_in_use, its own outcome', async () => {
    // Laravel's abort_unless path: the id exists but under another account.
    respondWith(json({ message: 'Order id already in use.' }, 409))
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('order_id_in_use')
  })

  it('an unrecognised 409 falls back to conflict rather than mislabelling itself', async () => {
    respondWith(json({ message: 'Some future 409 nobody has seen.' }, 409))
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('conflict')
  })

  it('separates all three 409 outcomes from each other', async () => {
    const kinds: string[] = []
    for (const body of [
      { message: 'Order rejected: duplicate order id at the engine.', reason: 'duplicate' },
      { message: 'No trading account for this user.' },
      { message: 'Order id already in use.' },
    ]) {
      respondWith(json(body, 409))
      kinds.push((await submitOrder(NEW_ORDER)).kind)
    }

    expect(kinds).toEqual(['duplicate', 'no_account', 'order_id_in_use'])
    expect(new Set(kinds).size).toBe(3)
  })

  it('502 → engine_unavailable, order saved as pending', async () => {
    respondWith(
      json(
        {
          message: 'Trading engine is unavailable; your order is saved as pending and was not submitted.',
          order_id: ORDER.id,
          status: 'pending',
        },
        502,
      ),
    )
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('engine_unavailable')
    if (outcome.kind !== 'engine_unavailable') throw new Error('narrowing')
    expect(outcome.orderId).toBe(ORDER.id)
  })

  it('503 → price_unavailable', async () => {
    respondWith(json({ reason: 'price_unavailable', message: 'No price available.' }, 503))
    expect((await submitOrder(NEW_ORDER)).kind).toBe('price_unavailable')
  })

  it('401 → unauthenticated', async () => {
    respondWith(json({ message: 'Unauthenticated.' }, 401))
    expect((await submitOrder(NEW_ORDER)).kind).toBe('unauthenticated')
  })

  it('an undocumented status → unexpected, never posing as a known outcome', async () => {
    respondWith(json({ message: 'Teapot.' }, 418))
    const outcome = await submitOrder(NEW_ORDER)

    expect(outcome.kind).toBe('unexpected')
    if (outcome.kind !== 'unexpected') throw new Error('narrowing')
    expect(outcome.status).toBe(418)
  })

  it('primes CSRF and sends the payload as JSON with credentials', async () => {
    respondWith(json(ORDER, 201))
    await submitOrder(NEW_ORDER)

    const [csrfCall, orderCall] = fetchMock.mock.calls
    expect(String(csrfCall[0])).toContain('/sanctum/csrf-cookie')
    expect(orderCall[1]?.method).toBe('POST')
    expect(orderCall[1]?.credentials).toBe('include')
    expect(JSON.parse(String(orderCall[1]?.body))).toEqual(NEW_ORDER)
  })
})

describe('cancelOrder — every documented outcome is distinct', () => {
  it('200 → cancelled', async () => {
    respondWith(json({ ...ORDER, status: 'cancelled' }, 200))
    const outcome = await cancelOrder(ORDER.id)

    expect(outcome.kind).toBe('cancelled')
    if (outcome.kind !== 'cancelled') throw new Error('narrowing')
    expect(outcome.order.status).toBe('cancelled')
  })

  it('403 → forbidden', async () => {
    respondWith(json({ message: 'This action is unauthorized.' }, 403))
    expect((await cancelOrder(ORDER.id)).kind).toBe('forbidden')
  })

  it('409 → not_cancellable, NOT forbidden', async () => {
    respondWith(
      json({ message: 'Order is not cancellable (unknown to the engine or no longer resting).', order_id: ORDER.id }, 409),
    )
    expect((await cancelOrder(ORDER.id)).kind).toBe('not_cancellable')
  })

  it('502 → engine_unavailable, NOT a rejection', async () => {
    respondWith(
      json({ message: 'Trading engine is unavailable; the order was not cancelled.', order_id: ORDER.id }, 502),
    )
    expect((await cancelOrder(ORDER.id)).kind).toBe('engine_unavailable')
  })

  it('401 → unauthenticated', async () => {
    respondWith(json({ message: 'Unauthenticated.' }, 401))
    expect((await cancelOrder(ORDER.id)).kind).toBe('unauthenticated')
  })

  it('an undocumented status → unexpected', async () => {
    respondWith(json({}, 500))
    expect((await cancelOrder(ORDER.id)).kind).toBe('unexpected')
  })

  it('sends DELETE to the order id, url-encoded', async () => {
    respondWith(json({ ...ORDER, status: 'cancelled' }, 200))
    await cancelOrder(ORDER.id)

    const call = fetchMock.mock.calls.at(-1)
    expect(String(call?.[0])).toContain(`/api/orders/${ORDER.id}`)
    expect(call?.[1]?.method).toBe('DELETE')
  })
})
