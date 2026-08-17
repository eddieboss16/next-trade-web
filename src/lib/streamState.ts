/**
 * PURE reducer over `/stream/:instrumentId` messages.
 *
 * Deliberately socket-free, mirroring the engine's own split between the pure
 * `candleAggregator` and the stateful `candleService` around it: everything
 * that decides what the chart shows is a function of (state, message), so the
 * required test can drive a real message sequence with no live connection.
 * `useInstrumentStream` is the thin stateful shell that owns the actual socket.
 */

import type { Candle, PriceLevel, StreamMessage, TradePrint } from './streamMessages'
import { config } from './config'

export interface StreamState {
  /** Finalized candles, ascending by `openTime`. */
  closed: Candle[]
  /** The candle currently accumulating ticks, or null between rollovers. */
  inProgress: Candle | null
  bids: PriceLevel[]
  asks: PriceLevel[]
  /** Most recent trade print first. */
  trades: TradePrint[]
  /** True once any depth snapshot has arrived (distinguishes "empty" from "unknown"). */
  hasDepth: boolean
}

export const initialStreamState: StreamState = {
  closed: [],
  inProgress: null,
  bids: [],
  asks: [],
  trades: [],
  hasDepth: false,
}

const MAX_CLOSED_CANDLES = config.closedCandleLimit
const MAX_TRADES = config.tradeBufferSize

/**
 * Inserts a finalized candle in ascending `openTime` order, replacing any
 * existing candle for the same bucket. Out-of-order arrival is defended against
 * here rather than assumed away — the engine orders its own emissions, but a
 * reconnect can replay history over live data.
 */
function upsertClosed(closed: Candle[], candle: Candle): Candle[] {
  const existing = closed.findIndex((c) => c.openTime === candle.openTime)
  if (existing !== -1) {
    const next = closed.slice()
    next[existing] = candle
    return next
  }

  const last = closed[closed.length - 1]
  const next =
    last === undefined || last.openTime < candle.openTime
      ? [...closed, candle]
      : [...closed, candle].sort((a, b) => a.openTime - b.openTime)

  return next.length > MAX_CLOSED_CANDLES
    ? next.slice(next.length - MAX_CLOSED_CANDLES)
    : next
}

export function reduceStreamMessage(
  state: StreamState,
  message: StreamMessage,
): StreamState {
  switch (message.type) {
    case 'candle_history':
      // A full replacement: this is the seed-on-subscribe frame, and on a
      // reconnect it is more authoritative than whatever we accumulated before.
      return {
        ...state,
        closed: [...message.closed].sort((a, b) => a.openTime - b.openTime),
        inProgress: message.inProgress,
      }

    case 'candle': {
      // An in-progress update. If it arrives for a bucket we already finalized
      // (reconnect replay), correct that closed candle instead of resurrecting
      // it as in-progress — a closed candle is immutable upstream, so the only
      // consistent reading is that our copy was stale.
      const alreadyClosed = state.closed.some(
        (c) => c.openTime === message.candle.openTime,
      )
      if (alreadyClosed) {
        return { ...state, closed: upsertClosed(state.closed, message.candle) }
      }
      return { ...state, inProgress: message.candle }
    }

    case 'candle_closed': {
      const closed = upsertClosed(state.closed, message.candle)
      // The finalized bucket is no longer in progress. Clearing it matters: the
      // engine sends `candle_closed` then immediately `candle` for the NEW
      // bucket, and leaving the old one in place would double-draw it — once as
      // a closed candle and once as the live one.
      const inProgress =
        state.inProgress && state.inProgress.openTime === message.candle.openTime
          ? null
          : state.inProgress
      return { ...state, closed, inProgress }
    }

    case 'depth':
      return {
        ...state,
        bids: message.bids,
        asks: message.asks,
        hasDepth: true,
      }

    case 'trade': {
      const print: TradePrint = {
        price: message.price,
        quantity: message.quantity,
        timestamp: message.timestamp,
      }
      return { ...state, trades: [print, ...state.trades].slice(0, MAX_TRADES) }
    }

    default:
      return state
  }
}

/** All candles to draw: finalized plus the live one, ascending by time. */
export function visibleCandles(state: StreamState): Candle[] {
  return state.inProgress ? [...state.closed, state.inProgress] : state.closed
}
