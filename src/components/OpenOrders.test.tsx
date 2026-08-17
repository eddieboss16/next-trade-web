import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenOrders } from './OpenOrders'
import type { Instrument } from '../lib/instruments'
import type { Order } from '../lib/orders'

const INSTRUMENT: Instrument = { id: 'AAPL', symbol: 'AAPL', priceScale: 2, quantityScale: 0 }

const RESTING: Order = {
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

/** GET /api/orders returns `orders`; DELETE returns `cancelResponse()`. */
function setupApi(orders: Order[], cancelResponse?: () => Response) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input)).pathname
    if (url === '/sanctum/csrf-cookie') {
      document.cookie = 'XSRF-TOKEN=csrf-token-value'
      return new Response(null, { status: 204 })
    }
    if (init?.method === 'DELETE' && cancelResponse) return cancelResponse()
    if (url === '/api/orders') return json(orders, 200)
    throw new Error(`Unexpected request: ${url}`)
  })
}

async function clickCancel() {
  const button = await screen.findByRole('button', { name: /cancel order/i })
  await userEvent.click(button)
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

const CANCEL_CASES: {
  name: string
  response: () => Response
  tone: string
  title: RegExp
  notMatch?: RegExp
}[] = [
  {
    name: '200 cancelled',
    response: () => json({ ...RESTING, status: 'cancelled' }, 200),
    tone: 'success',
    title: /order cancelled/i,
  },
  {
    name: '403 not the owner',
    response: () => json({ message: 'This action is unauthorized.' }, 403),
    tone: 'danger',
    title: /not your order/i,
    notMatch: /no longer cancellable/i,
  },
  {
    name: '409 not cancellable',
    response: () =>
      json(
        {
          message: 'Order is not cancellable (unknown to the engine or no longer resting).',
          order_id: RESTING.id,
        },
        409,
      ),
    tone: 'warning',
    title: /no longer cancellable/i,
    notMatch: /not your order/i,
  },
  {
    name: '502 engine unreachable',
    response: () =>
      json(
        { message: 'Trading engine is unavailable; the order was not cancelled.', order_id: RESTING.id },
        502,
      ),
    tone: 'warning',
    title: /engine unreachable — not cancelled/i,
    notMatch: /no longer cancellable/i,
  },
  {
    name: '401 unauthenticated',
    response: () => json({ message: 'Unauthenticated.' }, 401),
    tone: 'danger',
    title: /session expired/i,
  },
  {
    name: '500 undocumented',
    response: () => json({}, 500),
    tone: 'danger',
    title: /unexpected response \(500\)/i,
  },
]

describe('order cancellation (spec §3 required test)', () => {
  it.each(CANCEL_CASES)(
    '$name produces its own distinct UI state',
    async ({ response, tone, title, notMatch }) => {
      setupApi([RESTING], response)
      render(<OpenOrders instruments={[INSTRUMENT]} refreshToken={0} />)

      const notice = await clickCancel()

      expect(notice).toHaveAttribute('data-tone', tone)
      // The headline specifically — the detail text often repeats these words.
      expect(within(notice).getByTestId('feedback-title')).toHaveTextContent(title)
      if (notMatch) expect(notice).not.toHaveTextContent(notMatch)
    },
  )

  it('covers every cancel outcome the client can return', () => {
    // Headline distinctness is asserted over the pure mapping in
    // orderFeedback.test.ts; this only guards the table against drift.
    expect(CANCEL_CASES).toHaveLength(6)
  })

  it('leaves the order untouched on a 502 — the cancel did not happen', async () => {
    setupApi([RESTING], () =>
      json({ message: 'Trading engine is unavailable; the order was not cancelled.' }, 502),
    )
    render(<OpenOrders instruments={[INSTRUMENT]} refreshToken={0} />)

    await clickCancel()

    // Still listed as open, and still cancellable.
    expect(screen.getByText(/^open$/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /cancel order/i }),
    ).toBeInTheDocument()
  })

  it('applies the returned terminal state after a successful cancel', async () => {
    setupApi([RESTING], () => json({ ...RESTING, status: 'cancelled' }, 200))
    render(<OpenOrders instruments={[INSTRUMENT]} refreshToken={0} />)

    await clickCancel()

    expect(screen.getByText(/^cancelled$/i)).toBeInTheDocument()
    // No longer cancellable, so the button is gone.
    expect(
      screen.queryByRole('button', { name: /cancel order/i }),
    ).not.toBeInTheDocument()
  })
})

describe('order list', () => {
  it('renders prices scaled from the integer smallest unit', async () => {
    setupApi([RESTING])
    render(<OpenOrders instruments={[INSTRUMENT]} refreshToken={0} />)

    expect(await screen.findByText(/150\.25/)).toBeInTheDocument()
  })

  it('offers no cancel button for a terminal order', async () => {
    setupApi([{ ...RESTING, status: 'filled', filled_quantity: 10 }])
    render(<OpenOrders instruments={[INSTRUMENT]} refreshToken={0} />)

    await screen.findByText(/^filled/i)
    expect(
      screen.queryByRole('button', { name: /cancel order/i }),
    ).not.toBeInTheDocument()
  })

  it('shows an empty state rather than a blank panel', async () => {
    setupApi([])
    render(<OpenOrders instruments={[INSTRUMENT]} refreshToken={0} />)

    expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument()
  })
})
