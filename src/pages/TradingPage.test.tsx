import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AppProviders } from '../AppProviders'
import { FakeWebSocket, installFakeWebSocket } from '../test/fakeWebSocket'
import { isGapPoint, type ChartPoint } from '../lib/chartData'
import { API_INSTRUMENTS } from '../test/renderApp'
import { chartStub, lastSeriesData, resetChartStub } from '../test/chartStub'


const INSTRUMENT = 'AAPL'
const MINUTE = 60_000
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % MINUTE)
const TRADER = {
  id: 1,
  name: 'Trader',
  email: 'trader@example.com',
  account_id: 'acct-1',
}

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function candle(bucket: number, o: number, h: number, l: number, c: number) {
  return { openTime: T0 + bucket * MINUTE, open: o, high: h, low: l, close: c }
}

async function renderTradingView() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  )
  // Wait for the session check to land the user on the trading view. The
  // heading commits before React flushes the passive effect that opens the
  // socket, so wait for the socket itself rather than assuming it exists.
  await screen.findByRole('heading', { name: /order book/i })
  await waitFor(() => expect(FakeWebSocket.instances).not.toHaveLength(0))
  await act(async () => {
    FakeWebSocket.last.open()
  })
}

function emit(payload: unknown) {
  return act(async () => {
    FakeWebSocket.last.emit(payload)
  })
}

beforeEach(() => {
  resetChartStub()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input)).pathname
    if (url === '/api/user') return json(TRADER, 200)
    if (url === '/api/orders') return json([], 200)
    if (url === '/api/instruments') return json(API_INSTRUMENTS, 200)
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  installFakeWebSocket(vi.stubGlobal)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('instrument scales come from GET /api/instruments', () => {
  function renderApp() {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>,
    )
  }

  it('refuses to render anything priced when the scales cannot be loaded', async () => {
    // No local fallback scale exists on purpose: guessing one would render
    // every price off by a power of ten with no error.
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input)).pathname
      if (url === '/api/user') return json(TRADER, 200)
      if (url === '/api/orders') return json([], 200)
      if (url === '/api/instruments') return json({ message: 'boom' }, 500)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load instruments/i,
    )
    expect(
      screen.queryByRole('heading', { name: /order book/i }),
    ).not.toBeInTheDocument()
  })

  it('renders prices using the scale the endpoint returned, not a hardcoded 2', async () => {
    // price_scale 3 → a depth level of 15025 is 15.025, not 150.25.
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input)).pathname
      if (url === '/api/user') return json(TRADER, 200)
      if (url === '/api/orders') return json([], 200)
      if (url === '/api/instruments') {
        return json(
          [{ id: 'AAPL', symbol: 'AAPL', price_scale: 3, quantity_scale: 0 }],
          200,
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderApp()
    await screen.findByRole('heading', { name: /order book/i })
    await waitFor(() => expect(FakeWebSocket.instances).not.toHaveLength(0))
    await act(async () => {
      FakeWebSocket.last.open()
    })

    await emit({
      type: 'depth',
      instrumentId: INSTRUMENT,
      bids: [{ price: 15025, quantity: 5 }],
      asks: [],
    })

    expect(screen.getByText('15.025')).toBeInTheDocument()
    expect(screen.queryByText('150.25')).not.toBeInTheDocument()
  })
})

describe('live trading view (spec §2 required test)', () => {
  it('finalizes the current candle and starts a new one on candle_closed', async () => {
    await renderTradingView()

    const settled = candle(0, 15000, 15080, 14990, 15060)
    const live = candle(1, 15065, 15070, 15060, 15068)
    const finalized = candle(1, 15065, 15090, 15060, 15085)
    const fresh = candle(2, 15090, 15090, 15090, 15090)

    // Seed-on-subscribe, then a live tick into the current bucket.
    await emit({
      type: 'candle_history',
      instrumentId: INSTRUMENT,
      closed: [settled],
      inProgress: live,
    })

    expect(lastSeriesData<ChartPoint>()).toEqual([
      { time: T0 / 1000, open: 150, high: 150.8, low: 149.9, close: 150.6 },
      { time: (T0 + MINUTE) / 1000, open: 150.65, high: 150.7, low: 150.6, close: 150.68 },
    ])

    // The rollover, exactly as candleService.onTick emits it: candle_closed for
    // the finalized bucket, immediately followed by candle for the new one.
    await emit({ type: 'candle_closed', instrumentId: INSTRUMENT, candle: finalized })

    // Checked in the window BETWEEN the two frames: the finalized bucket must
    // already have stopped being the live candle. Assert it here and not only
    // after the next frame, because the following `candle` overwrites the live
    // slot anyway and would mask a failure to release it.
    expect(lastSeriesData<ChartPoint>()).toHaveLength(2)
    expect(lastSeriesData<ChartPoint>()[1]).toMatchObject({ close: 150.85 })

    await emit({ type: 'candle', instrumentId: INSTRUMENT, candle: fresh })

    const data = lastSeriesData<ChartPoint>()

    // Three candles: the earlier one, the now-finalized one, and the new live one.
    expect(data).toEqual([
      { time: T0 / 1000, open: 150, high: 150.8, low: 149.9, close: 150.6 },
      { time: (T0 + MINUTE) / 1000, open: 150.65, high: 150.9, low: 150.6, close: 150.85 },
      { time: (T0 + 2 * MINUTE) / 1000, open: 150.9, high: 150.9, low: 150.9, close: 150.9 },
    ])

    // The finalized bucket appears exactly once — not drawn as both a closed
    // candle and a lingering in-progress one.
    expect(data.filter((p) => p.time === (T0 + MINUTE) / 1000)).toHaveLength(1)

    // It kept its FINAL values (high 150.90 / close 150.85), not the mid-bucket
    // values it had while live (high 150.70 / close 150.68).
    expect(data[1]).toMatchObject({ high: 150.9, close: 150.85 })
  })

  it('renders a visible gap rather than a false flat line', async () => {
    await renderTradingView()

    // Buckets 1–3 had no ticks, so the engine emitted no candles for them.
    await emit({
      type: 'candle_history',
      instrumentId: INSTRUMENT,
      closed: [candle(0, 15000, 15000, 15000, 15000), candle(4, 15400, 15400, 15400, 15400)],
      inProgress: null,
    })

    const data = lastSeriesData<ChartPoint>()
    expect(data.map(isGapPoint)).toEqual([false, true, true, true, false])
    // No fabricated prices anywhere in the gap.
    expect(data.filter(isGapPoint).every((p) => !('close' in p))).toBe(true)
  })
})

describe('live trading view', () => {
  it('renders the order book from a depth snapshot', async () => {
    await renderTradingView()

    expect(
      screen.getByText(/waiting for the first depth snapshot/i),
    ).toBeInTheDocument()

    await emit({
      type: 'depth',
      instrumentId: INSTRUMENT,
      bids: [{ price: 14990, quantity: 5 }],
      asks: [{ price: 15010, quantity: 3 }],
    })

    expect(screen.getByText('149.90')).toBeInTheDocument()
    expect(screen.getByText('150.10')).toBeInTheDocument()
    expect(
      screen.queryByText(/waiting for the first depth snapshot/i),
    ).not.toBeInTheDocument()
  })

  it('distinguishes an empty book from a book it has not received', async () => {
    await renderTradingView()

    await emit({ type: 'depth', instrumentId: INSTRUMENT, bids: [], asks: [] })

    expect(screen.getByText(/no resting orders on either side/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/waiting for the first depth snapshot/i),
    ).not.toBeInTheDocument()
  })

  it('renders trade prints', async () => {
    await renderTradingView()

    await emit({
      type: 'trade',
      instrumentId: INSTRUMENT,
      price: 15025,
      quantity: 7,
      timestamp: T0,
    })

    expect(screen.getByText('150.25')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('connects to the engine on localhost, never 127.0.0.1', async () => {
    await renderTradingView()
    expect(FakeWebSocket.last.url).toBe(`ws://localhost:8080/stream/${INSTRUMENT}`)
    expect(FakeWebSocket.last.url).not.toContain('127.0.0.1')
  })

  it('reports connection state so a stalled socket cannot pass as a quiet market', async () => {
    await renderTradingView()
    expect(screen.getByText('Live')).toBeInTheDocument()

    await act(async () => {
      FakeWebSocket.last.serverClose()
    })

    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument()
  })

  it('survives a malformed frame without tearing down the chart', async () => {
    await renderTradingView()

    await emit({
      type: 'candle_history',
      instrumentId: INSTRUMENT,
      closed: [candle(0, 15000, 15000, 15000, 15000)],
      inProgress: null,
    })

    await act(async () => {
      FakeWebSocket.last.emitRaw('{ not json')
      FakeWebSocket.last.emit({ type: 'candle', instrumentId: INSTRUMENT })
    })

    // Still showing the last good state.
    expect(lastSeriesData<ChartPoint>()).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /order book/i })).toBeInTheDocument()
  })

  it('ignores frames for a different instrument', async () => {
    await renderTradingView()

    await emit({
      type: 'candle_history',
      instrumentId: 'SOMETHING_ELSE',
      closed: [candle(0, 999, 999, 999, 999)],
      inProgress: null,
    })

    expect(chartStub.series.setData).not.toHaveBeenCalled()
    expect(screen.getByText(/waiting for candle history/i)).toBeInTheDocument()
  })
})
