/**
 * Wire format for `WS /stream/:instrumentId`, transcribed from the engine's
 * `src/ws/broadcaster.ts`. Do not invent fields here — if a shape looks wrong,
 * the engine is the source of truth.
 *
 * INTEGERS: every `price` and `quantity` is an integer in the smallest unit,
 * and every timestamp (`openTime`, `timestamp`) is epoch MILLISECONDS.
 */

/** A finalized OHLC candle. O/H/L/C are integers; `openTime` is epoch ms. */
export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
}

export interface PriceLevel {
  price: number
  quantity: number
}

export interface TradePrint {
  price: number
  quantity: number
  /** Epoch ms. */
  timestamp: number
}

export type StreamMessage =
  | {
      type: 'candle_history'
      instrumentId: string
      closed: Candle[]
      inProgress: Candle | null
    }
  | { type: 'candle'; instrumentId: string; candle: Candle }
  | { type: 'candle_closed'; instrumentId: string; candle: Candle }
  | {
      type: 'trade'
      instrumentId: string
      price: number
      quantity: number
      timestamp: number
    }
  | {
      type: 'depth'
      instrumentId: string
      bids: PriceLevel[]
      asks: PriceLevel[]
    }

function isCandle(value: unknown): value is Candle {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.openTime === 'number' &&
    typeof c.open === 'number' &&
    typeof c.high === 'number' &&
    typeof c.low === 'number' &&
    typeof c.close === 'number'
  )
}

function isPriceLevelArray(value: unknown): value is PriceLevel[] {
  return (
    Array.isArray(value) &&
    value.every(
      (level) =>
        typeof level === 'object' &&
        level !== null &&
        typeof (level as PriceLevel).price === 'number' &&
        typeof (level as PriceLevel).quantity === 'number',
    )
  )
}

/**
 * Parses one raw WS frame. Returns `null` for anything unrecognised or
 * malformed rather than throwing — one bad frame must not tear down a live
 * chart, and an unknown `type` is a forward-compatible engine addition, not an
 * error.
 */
export function parseStreamMessage(raw: string): StreamMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  if (typeof message.instrumentId !== 'string') return null

  switch (message.type) {
    case 'candle_history':
      if (!Array.isArray(message.closed)) return null
      if (!message.closed.every(isCandle)) return null
      if (message.inProgress !== null && !isCandle(message.inProgress)) {
        return null
      }
      return {
        type: 'candle_history',
        instrumentId: message.instrumentId,
        closed: message.closed,
        inProgress: (message.inProgress as Candle | null) ?? null,
      }

    case 'candle':
    case 'candle_closed':
      if (!isCandle(message.candle)) return null
      return {
        type: message.type,
        instrumentId: message.instrumentId,
        candle: message.candle,
      }

    case 'trade':
      if (
        typeof message.price !== 'number' ||
        typeof message.quantity !== 'number' ||
        typeof message.timestamp !== 'number'
      ) {
        return null
      }
      return {
        type: 'trade',
        instrumentId: message.instrumentId,
        price: message.price,
        quantity: message.quantity,
        timestamp: message.timestamp,
      }

    case 'depth':
      if (!isPriceLevelArray(message.bids)) return null
      if (!isPriceLevelArray(message.asks)) return null
      return {
        type: 'depth',
        instrumentId: message.instrumentId,
        bids: message.bids,
        asks: message.asks,
      }

    default:
      return null
  }
}
