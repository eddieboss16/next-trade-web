// @vitest-environment node
// Pure functions — no DOM needed, and jsdom startup is the slow part here.
import { describe, expect, it } from 'vitest'
import type { Candle } from './streamMessages'
import { isGapPoint, toChartData, toChartTime } from './chartData'
import { ONE_MINUTE_MS as MINUTE } from './timeframe'

const T0 = 1_700_000_000_000 - (1_700_000_000_000 % MINUTE)

function candle(bucket: number, close: number): Candle {
  return {
    openTime: T0 + bucket * MINUTE,
    open: close,
    high: close,
    low: close,
    close,
  }
}

describe('gap rendering (spec §2 required test)', () => {
  it('renders a visible gap instead of a false flat line across skipped buckets', () => {
    // The engine skips empty buckets entirely: buckets 1–3 had no ticks, so no
    // candle exists for them. Buckets 0 and 4 are what actually arrived.
    const candles = [candle(0, 15000), candle(4, 15400)]

    const points = toChartData(candles, { priceScale: 2 })

    // Three whitespace slots sit between the two real candles — one per missing
    // bucket — so the chart shows a break, not two adjacent bars.
    expect(points).toHaveLength(5)
    expect(points.map(isGapPoint)).toEqual([false, true, true, true, false])

    // The gap slots carry NO price data. This is the whole point: a synthesized
    // flat candle would assert a price nobody observed. Whitespace asserts only
    // "nothing happened here", which is the fact the engine recorded.
    for (const point of points.slice(1, 4)) {
      expect(point).not.toHaveProperty('open')
      expect(point).not.toHaveProperty('high')
      expect(point).not.toHaveProperty('low')
      expect(point).not.toHaveProperty('close')
      expect(Object.keys(point)).toEqual(['time'])
    }

    // The gap slots land on the missing buckets' own timestamps.
    expect(points[1].time).toBe(toChartTime(T0 + 1 * MINUTE))
    expect(points[2].time).toBe(toChartTime(T0 + 2 * MINUTE))
    expect(points[3].time).toBe(toChartTime(T0 + 3 * MINUTE))

    // And neither real candle was altered to bridge the gap.
    expect(points[0]).toMatchObject({ close: 150 })
    expect(points[4]).toMatchObject({ close: 154 })
  })

  it('inserts nothing between consecutive buckets', () => {
    const points = toChartData([candle(0, 15000), candle(1, 15010)], {
      priceScale: 2,
    })
    expect(points).toHaveLength(2)
    expect(points.some(isGapPoint)).toBe(false)
  })

  it('caps a very long gap but still leaves it visible', () => {
    // A weekend on a 1-minute chart: ~2,880 empty buckets. Drawing them all
    // squeezes the real candles into an unreadable sliver, so the run is
    // capped — the gap must be visible, not to scale.
    const points = toChartData([candle(0, 15000), candle(2880, 15400)], {
      priceScale: 2,
      maxGapSlots: 10,
    })

    expect(points).toHaveLength(12)
    expect(points.filter(isGapPoint)).toHaveLength(10)
    // Still a break, and still no invented prices.
    expect(points.filter(isGapPoint).every((p) => !('close' in p))).toBe(true)
  })

  it('handles a single missing bucket', () => {
    const points = toChartData([candle(0, 15000), candle(2, 15200)], {
      priceScale: 2,
    })
    expect(points.map(isGapPoint)).toEqual([false, true, false])
  })
})

describe('unit conversion', () => {
  it('converts epoch milliseconds to the epoch seconds the chart expects', () => {
    // Off by 1000 and every candle silently renders in 1970.
    expect(toChartTime(T0)).toBe(T0 / 1000)
    expect(toChartTime(1_700_000_000_000)).toBe(1_700_000_000)
  })

  it('scales integer smallest-unit prices to decimals', () => {
    const points = toChartData(
      [{ openTime: T0, open: 15025, high: 15100, low: 14990, close: 15075 }],
      { priceScale: 2 },
    )
    expect(points[0]).toEqual({
      time: toChartTime(T0),
      open: 150.25,
      high: 151,
      low: 149.9,
      close: 150.75,
    })
  })

  it('respects a non-2 price scale', () => {
    const points = toChartData(
      [{ openTime: T0, open: 110250, high: 110250, low: 110250, close: 110250 }],
      { priceScale: 5 },
    )
    expect(points[0]).toMatchObject({ open: 1.1025 })
  })

  it('returns an empty series for no candles', () => {
    expect(toChartData([], { priceScale: 2 })).toEqual([])
  })
})
