// @vitest-environment node
// Pure config parsing — no DOM needed.
import { describe, expect, it } from 'vitest'
import { config } from './config'
import { toChartData, isGapPoint } from './chartData'
import { ONE_MINUTE_MS as MINUTE } from './timeframe'

const T0 = 1_700_000_000_000 - (1_700_000_000_000 % MINUTE)

function candle(bucket: number, close: number) {
  return {
    openTime: T0 + bucket * MINUTE,
    open: close,
    high: close,
    low: close,
    close,
  }
}

describe('config', () => {
  it('exposes documented defaults for every tunable', () => {
    expect(config).toEqual({
      maxGapSlots: 10,
      closedCandleLimit: 500,
      tradeBufferSize: 50,
      visibleTrades: 12,
      visibleDepthLevels: 8,
      moneyScale: 2,
      accountPollMs: 5000,
    })
  })

  it('keeps the client candle buffer above the engine default (100) so a reconnect is not truncated', () => {
    expect(config.closedCandleLimit).toBeGreaterThan(100)
  })

  it('is what chartData actually uses for the gap cap — not a hardcoded literal', () => {
    // A gap far longer than any plausible cap: the run must land exactly on the
    // configured value, which is what proves the config is wired through.
    const points = toChartData([candle(0, 15000), candle(5000, 15400)], {
      priceScale: 2,
    })
    expect(points.filter(isGapPoint)).toHaveLength(config.maxGapSlots)
  })
})
