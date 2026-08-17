import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchInstruments,
  findInstrument,
  formatPrice,
  formatQuantity,
  toSmallestUnit,
} from './instruments'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The endpoint's real shape: snake_case keys, scales as JSON integers. */
const API_ROWS = [
  { id: 'AAPL', symbol: 'AAPL', price_scale: 2, quantity_scale: 0 },
  { id: 'EURUSD', symbol: 'EUR/USD', price_scale: 5, quantity_scale: 2 },
]

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchInstruments', () => {
  it('maps the API rows to camelCase, keeping both scales', async () => {
    fetchMock.mockResolvedValue(json(API_ROWS, 200))

    expect(await fetchInstruments()).toEqual([
      { id: 'AAPL', symbol: 'AAPL', priceScale: 2, quantityScale: 0 },
      { id: 'EURUSD', symbol: 'EUR/USD', priceScale: 5, quantityScale: 2 },
    ])
  })

  it('requests the documented path with credentials', async () => {
    fetchMock.mockResolvedValue(json(API_ROWS, 200))
    await fetchInstruments()

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/instruments')
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include')
  })

  it('skips a malformed row rather than emitting NaN scales downstream', async () => {
    // A scale arriving as a STRING is the exact regression the endpoint exists
    // to prevent; it must not silently become NaN prices.
    fetchMock.mockResolvedValue(
      json(
        [
          { id: 'AAPL', symbol: 'AAPL', price_scale: '2', quantity_scale: 0 },
          { id: 'MSFT', symbol: 'MSFT', price_scale: 2, quantity_scale: 0 },
        ],
        200,
      ),
    )

    const instruments = await fetchInstruments()
    expect(instruments.map((i) => i.id)).toEqual(['MSFT'])
  })

  it('throws on a non-2xx so the provider can show a real error state', async () => {
    fetchMock.mockResolvedValue(json({ message: 'boom' }, 500))
    await expect(fetchInstruments()).rejects.toThrow(/500/)
  })

  it('throws when the body is not an array', async () => {
    fetchMock.mockResolvedValue(json({ instruments: [] }, 200))
    await expect(fetchInstruments()).rejects.toThrow(/array/i)
  })
})

describe('scaling helpers', () => {
  it('formats prices with the instrument’s own scale', () => {
    expect(formatPrice(15025, 2)).toBe('150.25')
    expect(formatPrice(110250, 5)).toBe('1.10250')
  })

  it('formats quantities with the quantity scale', () => {
    expect(formatQuantity(10, 0)).toBe('10')
    expect(formatQuantity(1050, 2)).toBe('10.50')
  })

  it('converts a typed display value to the integer smallest unit', () => {
    expect(toSmallestUnit('150.25', 2)).toBe(15025)
    expect(toSmallestUnit('10', 0)).toBe(10)
    expect(toSmallestUnit('10.5', 2)).toBe(1050)
  })

  it('returns null for input that is not a number, so submit stays disabled', () => {
    expect(toSmallestUnit('', 2)).toBeNull()
    expect(toSmallestUnit('  ', 2)).toBeNull()
    expect(toSmallestUnit('abc', 2)).toBeNull()
  })

  it('finds an instrument by id', () => {
    const list = [
      { id: 'AAPL', symbol: 'AAPL', priceScale: 2, quantityScale: 0 },
      { id: 'MSFT', symbol: 'MSFT', priceScale: 2, quantityScale: 0 },
    ]
    expect(findInstrument(list, 'MSFT')?.symbol).toBe('MSFT')
    expect(findInstrument(list, 'NOPE')).toBeUndefined()
  })
})
