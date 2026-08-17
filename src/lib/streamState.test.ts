// @vitest-environment node
// The reducer is pure — no DOM needed, and jsdom startup is the slow part here.
import { describe, expect, it } from 'vitest'
import { parseStreamMessage, type Candle } from './streamMessages'
import {
  initialStreamState,
  reduceStreamMessage,
  visibleCandles,
  type StreamState,
} from './streamState'

const INSTRUMENT = 'AAPL'
const MINUTE = 60_000
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % MINUTE)

function candle(bucket: number, o: number, h: number, l: number, c: number): Candle {
  return { openTime: T0 + bucket * MINUTE, open: o, high: h, low: l, close: c }
}

/**
 * Feeds frames the way the socket does: serialize, parse, reduce. This keeps
 * the tests honest about the wire format instead of hand-building state.
 */
function play(state: StreamState, frames: unknown[]): StreamState {
  return frames.reduce<StreamState>((current, frame) => {
    const message = parseStreamMessage(JSON.stringify(frame))
    if (!message) throw new Error(`Frame failed to parse: ${JSON.stringify(frame)}`)
    return reduceStreamMessage(current, message)
  }, state)
}

describe('candle_closed (spec §2 required test)', () => {
  it('finalizes the in-progress candle and starts a new one', () => {
    // The exact sequence the engine emits on a bucket rollover, per
    // candleService.onTick: candle_history on subscribe, live `candle` updates,
    // then `candle_closed` for the finalized bucket IMMEDIATELY followed by a
    // `candle` for the new one.
    const opening = candle(0, 15000, 15000, 15000, 15000)
    const growing = candle(0, 15000, 15080, 14990, 15050)
    const finalized = candle(0, 15000, 15080, 14990, 15060)
    const fresh = candle(1, 15065, 15065, 15065, 15065)

    let state = play(initialStreamState, [
      { type: 'candle_history', instrumentId: INSTRUMENT, closed: [], inProgress: opening },
      { type: 'candle', instrumentId: INSTRUMENT, candle: growing },
    ])

    // Before the rollover: nothing finalized, one live candle.
    expect(state.closed).toHaveLength(0)
    expect(state.inProgress).toEqual(growing)

    state = play(state, [
      { type: 'candle_closed', instrumentId: INSTRUMENT, candle: finalized },
    ])

    // The finalized candle moved into the closed series...
    expect(state.closed).toEqual([finalized])
    // ...and is no longer the in-progress one, so it cannot be drawn twice.
    expect(state.inProgress).toBeNull()
    expect(visibleCandles(state)).toEqual([finalized])

    state = play(state, [
      { type: 'candle', instrumentId: INSTRUMENT, candle: fresh },
    ])

    // The new bucket is live, the finalized one untouched beside it.
    expect(state.closed).toEqual([finalized])
    expect(state.inProgress).toEqual(fresh)
    expect(visibleCandles(state)).toEqual([finalized, fresh])

    // The close of the finalized candle is the last tick it saw — not the open
    // of the candle that replaced it.
    expect(state.closed[0].close).toBe(15060)
    expect(state.inProgress?.open).toBe(15065)
  })

  it('does not double-count when a rollover repeats (reconnect replay)', () => {
    const finalized = candle(0, 15000, 15080, 14990, 15060)
    const state = play(initialStreamState, [
      { type: 'candle_closed', instrumentId: INSTRUMENT, candle: finalized },
      { type: 'candle_closed', instrumentId: INSTRUMENT, candle: finalized },
    ])
    expect(state.closed).toEqual([finalized])
  })

  it('corrects a closed candle if a late `candle` update arrives for that bucket', () => {
    const finalized = candle(0, 15000, 15080, 14990, 15060)
    const corrected = candle(0, 15000, 15090, 14990, 15070)

    const state = play(initialStreamState, [
      { type: 'candle_closed', instrumentId: INSTRUMENT, candle: finalized },
      { type: 'candle', instrumentId: INSTRUMENT, candle: corrected },
    ])

    // Corrected in place — never resurrected as the live candle.
    expect(state.closed).toEqual([corrected])
    expect(state.inProgress).toBeNull()
  })
})

describe('candle history', () => {
  it('seeds from candle_history and keeps candles in ascending time order', () => {
    const state = play(initialStreamState, [
      {
        type: 'candle_history',
        instrumentId: INSTRUMENT,
        closed: [candle(2, 3, 3, 3, 3), candle(0, 1, 1, 1, 1), candle(1, 2, 2, 2, 2)],
        inProgress: candle(3, 4, 4, 4, 4),
      },
    ])

    expect(state.closed.map((c) => c.openTime)).toEqual([
      T0,
      T0 + MINUTE,
      T0 + 2 * MINUTE,
    ])
    expect(state.inProgress?.openTime).toBe(T0 + 3 * MINUTE)
  })

  it('replaces prior state on a reconnect history frame', () => {
    let state = play(initialStreamState, [
      { type: 'candle_history', instrumentId: INSTRUMENT, closed: [candle(0, 1, 1, 1, 1)], inProgress: null },
    ])
    state = play(state, [
      { type: 'candle_history', instrumentId: INSTRUMENT, closed: [candle(5, 9, 9, 9, 9)], inProgress: null },
    ])
    expect(state.closed).toHaveLength(1)
    expect(state.closed[0].openTime).toBe(T0 + 5 * MINUTE)
  })
})

describe('depth and trades', () => {
  it('replaces the book wholesale on each snapshot — the engine sends no diffs', () => {
    let state = play(initialStreamState, [
      {
        type: 'depth',
        instrumentId: INSTRUMENT,
        bids: [{ price: 14990, quantity: 5 }],
        asks: [{ price: 15010, quantity: 3 }],
      },
    ])
    expect(state.hasDepth).toBe(true)
    expect(state.bids).toEqual([{ price: 14990, quantity: 5 }])

    state = play(state, [
      {
        type: 'depth',
        instrumentId: INSTRUMENT,
        bids: [{ price: 14995, quantity: 2 }],
        asks: [],
      },
    ])
    expect(state.bids).toEqual([{ price: 14995, quantity: 2 }])
    expect(state.asks).toEqual([])
  })

  it('distinguishes "no snapshot yet" from "an empty book"', () => {
    expect(initialStreamState.hasDepth).toBe(false)
    const state = play(initialStreamState, [
      { type: 'depth', instrumentId: INSTRUMENT, bids: [], asks: [] },
    ])
    expect(state.hasDepth).toBe(true)
    expect(state.bids).toEqual([])
  })

  it('keeps trade prints newest first', () => {
    const state = play(initialStreamState, [
      { type: 'trade', instrumentId: INSTRUMENT, price: 15000, quantity: 1, timestamp: T0 },
      { type: 'trade', instrumentId: INSTRUMENT, price: 15010, quantity: 2, timestamp: T0 + 1 },
    ])
    expect(state.trades.map((t) => t.price)).toEqual([15010, 15000])
  })
})

describe('frame parsing', () => {
  it('drops malformed frames instead of throwing', () => {
    expect(parseStreamMessage('not json')).toBeNull()
    expect(parseStreamMessage(JSON.stringify({ type: 'candle' }))).toBeNull()
    expect(
      parseStreamMessage(
        JSON.stringify({ type: 'candle', instrumentId: 'A', candle: { openTime: 1 } }),
      ),
    ).toBeNull()
    expect(
      parseStreamMessage(JSON.stringify({ type: 'future_event', instrumentId: 'A' })),
    ).toBeNull()
  })

  it('accepts the engine frames verbatim', () => {
    const frame = {
      type: 'depth',
      instrumentId: 'AAPL',
      bids: [{ price: 1, quantity: 2 }],
      asks: [{ price: 3, quantity: 4 }],
    }
    expect(parseStreamMessage(JSON.stringify(frame))).toEqual(frame)
  })
})
