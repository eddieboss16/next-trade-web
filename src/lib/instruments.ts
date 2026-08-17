/**
 * Instrument reference data from `GET /api/instruments` — the single source of
 * truth for display scales.
 *
 * Storage everywhere (engine, API, WS frames) is an INTEGER in the smallest
 * unit; `price_scale` / `quantity_scale` say how many implied decimals to apply
 * for display, and never touch maths. Fetching them means a scale can no longer
 * drift out of sync with the database — which would silently render every price
 * off by a power of ten with no error.
 *
 * Public endpoint, no auth, returns active and inactive instruments alike, so
 * historical orders can always be priced.
 */

import { apiRequest } from './api'

export interface Instrument {
  /** Engine instrument id — the `/stream/:instrumentId` path segment. */
  id: string
  /** Display symbol, e.g. "AAPL". */
  symbol: string
  /** Implied decimals on price. 2 → 15025 renders 150.25. */
  priceScale: number
  /** Implied decimals on quantity. 0 → quantities are whole units. */
  quantityScale: number
}

function isScale(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Maps one API row, or null if it doesn't match the documented shape. */
function toInstrument(row: unknown): Instrument | null {
  if (typeof row !== 'object' || row === null) return null
  const { id, symbol, price_scale, quantity_scale } = row as Record<string, unknown>

  if (typeof id !== 'string' || typeof symbol !== 'string') return null
  // The API pins these as JSON integers, not strings — if that ever regresses,
  // fail visibly here rather than producing NaN prices downstream.
  if (!isScale(price_scale) || !isScale(quantity_scale)) return null

  return { id, symbol, priceScale: price_scale, quantityScale: quantity_scale }
}

export async function fetchInstruments(): Promise<Instrument[]> {
  const response = await apiRequest('/api/instruments')
  if (!response.ok) {
    throw new Error(`GET /api/instruments failed with status ${response.status}`)
  }

  const body: unknown = await response.json()
  if (!Array.isArray(body)) {
    throw new Error('GET /api/instruments did not return an array')
  }

  const instruments: Instrument[] = []
  for (const row of body) {
    const instrument = toInstrument(row)
    if (instrument) {
      instruments.push(instrument)
    } else {
      console.error(
        `[instruments] Skipping malformed row: ${JSON.stringify(row)}`,
      )
    }
  }
  return instruments
}

export function findInstrument(
  instruments: Instrument[],
  id: string,
): Instrument | undefined {
  return instruments.find((instrument) => instrument.id === id)
}

/** Integer smallest unit → display number. 15025 @ scale 2 → 150.25. */
export function toDisplayValue(value: number, scale: number): number {
  return value / 10 ** scale
}

/** Integer smallest unit → fixed-decimal string, for table cells. */
export function formatScaled(value: number, scale: number): string {
  return toDisplayValue(value, scale).toFixed(scale)
}

/** Integer smallest-unit price → fixed-decimal string. */
export function formatPrice(price: number, priceScale: number): string {
  return formatScaled(price, priceScale)
}

/** Integer smallest-unit quantity → string (plain integer when scale is 0). */
export function formatQuantity(quantity: number, quantityScale: number): string {
  return formatScaled(quantity, quantityScale)
}

/**
 * Typed display value → integer smallest unit, the only form the API accepts.
 * Returns null for anything non-numeric so callers can keep submit disabled.
 */
export function toSmallestUnit(input: string, scale: number): number | null {
  if (input.trim() === '') return null
  const value = Number(input)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 10 ** scale)
}
