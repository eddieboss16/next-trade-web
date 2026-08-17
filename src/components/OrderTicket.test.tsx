import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderTicket } from './OrderTicket'
import type { Instrument } from '../lib/instruments'
import type { Order } from '../lib/orders'

const INSTRUMENT: Instrument = { id: 'AAPL', symbol: 'AAPL', priceScale: 2, quantityScale: 0 }

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

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function respondWith(response: () => Response) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input)).pathname
    if (url === '/sanctum/csrf-cookie') {
      document.cookie = 'XSRF-TOKEN=csrf-token-value'
      return new Response(null, { status: 204 })
    }
    return response()
  })
}

/** The `id` sent on each POST /api/orders, in order. */
function submittedIds(): string[] {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).endsWith('/api/orders'))
    .map((call) => JSON.parse(String(call[1]?.body)).id)
}

/** Fills a valid limit ticket and submits it. */
async function submitTicket() {
  const quantity = screen.getByLabelText(/quantity/i)
  await userEvent.clear(quantity)
  await userEvent.type(quantity, '10')

  const price = screen.getByLabelText(/limit price/i)
  await userEvent.clear(price)
  await userEvent.type(price, '150.25')

  await userEvent.click(screen.getByRole('button', { name: /buy aapl/i }))
  return screen.findByRole('status')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Every documented outcome of POST /api/orders, with the UI it must produce.
 * `notMatch` pins the distinctions the spec calls out explicitly — a margin
 * rejection must not read as a generic error, a 502 must not read as a
 * rejection or a validation failure.
 */
const SUBMIT_CASES: {
  name: string
  response: () => Response
  tone: string
  title: RegExp
  detail?: RegExp
  notMatch?: RegExp
}[] = [
  {
    name: '201 accepted — resting',
    response: () => json(ORDER, 201),
    tone: 'success',
    title: /order resting/i,
    detail: /resting in the book/i,
  },
  {
    name: '201 accepted — filled',
    response: () => json({ ...ORDER, status: 'filled', filled_quantity: 10 }, 201),
    tone: 'success',
    title: /order filled/i,
    detail: /filled 10 of 10/i,
  },
  {
    name: '201 accepted — partially filled',
    response: () =>
      json({ ...ORDER, status: 'partially_filled', filled_quantity: 4 }, 201),
    tone: 'success',
    title: /order partially filled/i,
    detail: /filled 4 of 10/i,
  },
  {
    name: '200 idempotent replay',
    response: () => json(ORDER, 200),
    tone: 'info',
    title: /already submitted/i,
    detail: /nothing was sent to the engine a second time/i,
    notMatch: /rejected/i,
  },
  {
    name: '422 insufficient margin',
    response: () =>
      json(
        {
          message: 'Order rejected: would breach the minimum margin level.',
          reason: 'insufficient_margin',
          projected_margin_level_pct: 87.5,
          required_min_pct: 100,
        },
        422,
      ),
    tone: 'warning',
    title: /insufficient margin/i,
    // The actual numbers, not a generic "something went wrong".
    detail: /87\.5%.*below the required 100%/i,
    // Must not read as an engine rejection — this never reached the engine.
    notMatch: /rejected by the engine/i,
  },
  {
    name: '422 engine rejection',
    response: () =>
      json(
        {
          message: 'Order rejected by the engine.',
          reason: 'insufficient liquidity',
          order_id: ORDER.id,
        },
        422,
      ),
    tone: 'danger',
    title: /rejected by the engine/i,
    detail: /insufficient liquidity/i,
    notMatch: /margin/i,
  },
  {
    name: '422 validation error',
    response: () =>
      json(
        {
          message: 'The given data was invalid.',
          errors: { quantity: ['The quantity must be at least 1.'] },
        },
        422,
      ),
    tone: 'warning',
    title: /check the order details/i,
    detail: /quantity must be at least 1/i,
    notMatch: /margin|engine/i,
  },
  {
    name: '409 duplicate id',
    response: () =>
      json(
        {
          message: 'Order rejected: duplicate order id at the engine.',
          reason: 'duplicate',
          order_id: ORDER.id,
        },
        409,
      ),
    tone: 'danger',
    title: /duplicate order id/i,
  },
  {
    name: '409 no trading account (message-only)',
    response: () => json({ message: 'No trading account for this user.' }, 409),
    tone: 'danger',
    title: /no trading account/i,
    detail: /cannot be placed until an account is linked/i,
    notMatch: /duplicate/i,
  },
  {
    name: '409 order id already in use (message-only)',
    response: () => json({ message: 'Order id already in use.' }, 409),
    tone: 'danger',
    title: /order id already in use/i,
    detail: /belongs to a different account/i,
    notMatch: /duplicate|no trading account/i,
  },
  {
    name: '409 unrecognised',
    response: () => json({ message: 'Some future 409 nobody has seen.' }, 409),
    tone: 'danger',
    title: /order could not be placed/i,
    detail: /matches none of the documented cases/i,
    notMatch: /duplicate|no trading account/i,
  },
  {
    name: '502 engine unreachable',
    response: () =>
      json(
        {
          message:
            'Trading engine is unavailable; your order is saved as pending and was not submitted.',
          order_id: ORDER.id,
          status: 'pending',
        },
        502,
      ),
    tone: 'warning',
    title: /engine unreachable — order saved as pending/i,
    // Must say the order EXISTS and must warn against resubmitting.
    detail: /was NOT rejected, and it was NOT submitted/i,
    notMatch: /invalid|check the order details/i,
  },
  {
    name: '503 price unavailable',
    response: () =>
      json({ reason: 'price_unavailable', message: 'No price available for AAPL.' }, 503),
    tone: 'warning',
    title: /no price available/i,
    detail: /margin cannot be checked without a price/i,
  },
  {
    name: '401 unauthenticated',
    response: () => json({ message: 'Unauthenticated.' }, 401),
    tone: 'danger',
    title: /session expired/i,
  },
  {
    name: '418 undocumented status',
    response: () => json({ message: 'Teapot.' }, 418),
    tone: 'danger',
    title: /unexpected response \(418\)/i,
    detail: /not in the documented contract/i,
  },
]

describe('order entry feedback (spec §3 required test)', () => {
  it.each(SUBMIT_CASES)(
    '$name produces its own distinct UI state',
    async ({ response, tone, title, detail, notMatch }) => {
      respondWith(response)
      render(<OrderTicket instrument={INSTRUMENT} />)

      const notice = await submitTicket()

      expect(notice).toHaveAttribute('data-tone', tone)
      // The headline specifically — the detail text often repeats these words.
      expect(within(notice).getByTestId('feedback-title')).toHaveTextContent(title)
      if (detail) expect(notice).toHaveTextContent(detail)
      if (notMatch) expect(notice).not.toHaveTextContent(notMatch)
    },
  )

  it('covers every outcome the client can return', () => {
    // Guards against this table drifting behind the contract. Headline
    // DISTINCTNESS is asserted exhaustively over the pure mapping in
    // orderFeedback.test.ts — doing it here would mean 13 more form renders
    // for a property that has nothing to do with the DOM.
    expect(SUBMIT_CASES).toHaveLength(15)
  })
})

describe('order ticket', () => {
  it('converts the displayed decimal price to the integer the API requires', async () => {
    respondWith(() => json(ORDER, 201))
    render(<OrderTicket instrument={INSTRUMENT} />)
    await submitTicket()

    const orderCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith('/api/orders'),
    )
    const body = JSON.parse(String(orderCall?.[1]?.body))
    // 150.25 at priceScale 2 → 15025, not 150.25.
    expect(body.price).toBe(15025)
    expect(body.quantity).toBe(10)
  })

  it('omits price entirely for a market order — the API prohibits the field', async () => {
    respondWith(() => json({ ...ORDER, type: 'market', price: null }, 201))
    render(<OrderTicket instrument={INSTRUMENT} />)

    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'market')
    expect(screen.queryByLabelText(/limit price/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /buy aapl/i }))
    await screen.findByRole('status')

    const orderCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith('/api/orders'),
    )
    const body = JSON.parse(String(orderCall?.[1]?.body))
    expect('price' in body).toBe(false)
  })

  it('sends a caller-owned uuid so a double-submit replays instead of duplicating', async () => {
    respondWith(() => json(ORDER, 201))
    render(<OrderTicket instrument={INSTRUMENT} />)
    await submitTicket()

    const body = JSON.parse(
      String(
        fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/orders'))?.[1]
          ?.body,
      ),
    )
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('REUSES the key after a 502, so an ignored warning cannot create a second pending order', async () => {
    // The 502 inserted a row as `pending`. Laravel's guard is Order::find($id),
    // so resubmitting must carry the SAME id — then it replays (200) instead of
    // inserting a second pending order. A fresh uuid here would duplicate.
    respondWith(() =>
      json(
        {
          message: 'Trading engine is unavailable; your order is saved as pending.',
          order_id: ORDER.id,
          status: 'pending',
        },
        502,
      ),
    )
    render(<OrderTicket instrument={INSTRUMENT} />)

    await submitTicket()
    await submitTicket()

    expect(submittedIds()).toEqual([expect.any(String), expect.any(String)])
    const [first, second] = submittedIds()
    expect(second).toBe(first)
  })

  it('mints a new key when the ticket is EDITED after a 502 — a different order is not a replay', async () => {
    // Reusing the key here would replay the old pending order and silently
    // discard the quantity the user just changed.
    respondWith(() =>
      json({ message: 'Trading engine is unavailable.', order_id: ORDER.id }, 502),
    )
    render(<OrderTicket instrument={INSTRUMENT} />)

    await submitTicket()

    const quantity = screen.getByLabelText(/quantity/i)
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '25')
    await userEvent.click(screen.getByRole('button', { name: /buy aapl/i }))
    await screen.findByRole('status')

    const [first, second] = submittedIds()
    expect(second).not.toBe(first)
  })

  it('rotates the idempotency key after acceptance, so the next ticket is a new order', async () => {
    respondWith(() => json(ORDER, 201))
    render(<OrderTicket instrument={INSTRUMENT} />)

    await submitTicket()
    await submitTicket()

    const ids = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith('/api/orders'))
      .map((call) => JSON.parse(String(call[1]?.body)).id)

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('KEEPS the idempotency key when nothing was stored, so a corrected retry stays the same order', async () => {
    // A margin rejection never created a row; resubmitting after fixing the
    // quantity is the same logical order, so the key must not rotate.
    respondWith(() =>
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
    render(<OrderTicket instrument={INSTRUMENT} />)

    await submitTicket()
    await submitTicket()

    const ids = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith('/api/orders'))
      .map((call) => JSON.parse(String(call[1]?.body)).id)

    expect(ids[0]).toBe(ids[1])
  })

  it('notifies the parent to refresh after a 502, because the order EXISTS as pending', async () => {
    const onOrderChanged = vi.fn()
    respondWith(() =>
      json(
        { message: 'Trading engine is unavailable.', order_id: ORDER.id, status: 'pending' },
        502,
      ),
    )
    render(<OrderTicket instrument={INSTRUMENT} onOrderChanged={onOrderChanged} />)

    await submitTicket()

    expect(onOrderChanged).toHaveBeenCalled()
  })

  it('does not refresh the list when nothing was stored', async () => {
    const onOrderChanged = vi.fn()
    respondWith(() =>
      json({ message: 'The given data was invalid.', errors: { quantity: ['Bad.'] } }, 422),
    )
    render(<OrderTicket instrument={INSTRUMENT} onOrderChanged={onOrderChanged} />)

    await submitTicket()

    expect(onOrderChanged).not.toHaveBeenCalled()
  })
})
