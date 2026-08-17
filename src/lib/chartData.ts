/**
 * Candle → chart-series data. PURE, so gap rendering is testable without a
 * canvas.
 *
 * Two conversions happen here and nowhere else:
 *
 *  1. PRICE: the engine broadcasts integers in the smallest price unit
 *     (15025 @ priceScale 2). The chart draws decimals (150.25).
 *  2. TIME: the engine sends epoch MILLISECONDS (`openTime`); lightweight-charts
 *     wants epoch SECONDS. Getting this wrong doesn't error — it silently
 *     renders every candle in 1970.
 *
 * GAP POLICY (the frontend's half of the contract). The engine's aggregator
 * deliberately emits NO candle for a bucket with no ticks, and never fabricates
 * flat placeholders — its `CLAUDE.md` names the frontend as responsible for
 * "rendering sensible gaps". Left alone, a candlestick series draws its points
 * consecutively, so a 09:00 candle followed by a 09:05 candle sits shoulder to
 * shoulder and reads as five minutes of continuous trading that never happened.
 *
 * The fix is WHITESPACE points: `{ time }` with no OHLC. They occupy a slot on
 * the time scale and draw nothing, producing a real visible break. Crucially
 * they invent no prices — a whitespace point asserts "no data here", which is
 * exactly the fact the engine recorded. Synthesizing flat OHLC candles across
 * the gap would assert a price that was never observed, which is the thing both
 * repos refuse to do.
 */

import type {
  CandlestickData,
  UTCTimestamp,
  WhitespaceData,
} from 'lightweight-charts'
import type { Candle } from './streamMessages'
import { ONE_MINUTE_MS } from './timeframe'
import { config } from './config'

export type ChartPoint =
  | CandlestickData<UTCTimestamp>
  | WhitespaceData<UTCTimestamp>

export interface ChartDataOptions {
  /** Decimal places the integer prices are scaled by. */
  priceScale: number
  /** Bucket size in ms. Must match the engine's timeframe. */
  timeframeMs?: number
  /**
   * Cap on whitespace slots inserted per gap. Defaults to `config.maxGapSlots`
   * (env: `VITE_MAX_GAP_SLOTS`) — see config.ts for the rationale. Passed
   * explicitly only by tests that pin a specific cap.
   */
  maxGapSlots?: number
}

/** Epoch ms → the epoch-seconds stamp lightweight-charts expects. */
export function toChartTime(epochMs: number): UTCTimestamp {
  return Math.floor(epochMs / 1000) as UTCTimestamp
}

function toCandlePoint(
  candle: Candle,
  priceScale: number,
): CandlestickData<UTCTimestamp> {
  const divisor = 10 ** priceScale
  return {
    time: toChartTime(candle.openTime),
    open: candle.open / divisor,
    high: candle.high / divisor,
    low: candle.low / divisor,
    close: candle.close / divisor,
  }
}

/** True when a point is a whitespace (gap) slot rather than a drawn candle. */
export function isGapPoint(point: ChartPoint): boolean {
  return !('close' in point)
}

/**
 * Builds the series data, inserting whitespace for every skipped bucket.
 * Input must be ascending by `openTime` (the reducer guarantees this).
 */
export function toChartData(
  candles: Candle[],
  options: ChartDataOptions,
): ChartPoint[] {
  const { priceScale } = options
  const timeframeMs = options.timeframeMs ?? ONE_MINUTE_MS
  const maxGapSlots = options.maxGapSlots ?? config.maxGapSlots

  const points: ChartPoint[] = []

  for (const [index, candle] of candles.entries()) {
    const previous = candles[index - 1]

    if (previous !== undefined) {
      const missingBuckets =
        Math.round((candle.openTime - previous.openTime) / timeframeMs) - 1

      if (missingBuckets > 0) {
        const slots = Math.min(missingBuckets, maxGapSlots)
        for (let slot = 1; slot <= slots; slot += 1) {
          points.push({
            time: toChartTime(previous.openTime + slot * timeframeMs),
          })
        }
      }
    }

    points.push(toCandlePoint(candle, priceScale))
  }

  return points
}
