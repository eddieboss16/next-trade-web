/**
 * Test-time stand-in for `lightweight-charts`, wired in by `test.alias` in
 * vite.config.ts.
 *
 * WHY AN ALIAS AND NOT `vi.mock`: `vi.mock` is registered per test FILE, but
 * with `isolate: false` several files share one module registry. Whichever file
 * imports `CandleChart` first wins — if that file has no `vi.mock`, the real
 * library is cached and every later file silently gets the unmocked module.
 * That produced exactly one such failure (the chart series receiving no data)
 * and it depended purely on which worker a file landed on.
 *
 * An alias is resolved by the bundler for the whole run, so every file sees the
 * same module no matter the order. The real library is never usable in tests
 * anyway — it needs a canvas jsdom does not have.
 */

import { vi } from 'vitest'

export const chartStub = {
  series: {
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
  },
  chart: {
    addSeries: vi.fn(() => chartStub.series),
    remove: vi.fn(),
    applyOptions: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  },
}

/** Call in `beforeEach` — the stub is shared across files by design. */
export function resetChartStub(): void {
  chartStub.series.setData.mockClear()
  chartStub.series.update.mockClear()
  chartStub.series.applyOptions.mockClear()
  chartStub.chart.addSeries.mockClear()
  chartStub.chart.remove.mockClear()
}

/** The data most recently handed to the candlestick series. */
export function lastSeriesData<T>(): T[] {
  const calls = chartStub.series.setData.mock.calls
  if (calls.length === 0) {
    throw new Error('The candlestick series never received any data.')
  }
  return calls.at(-1)![0] as T[]
}

// --- the `lightweight-charts` surface CandleChart actually uses ---

export const createChart = vi.fn(() => chartStub.chart)
export const CandlestickSeries = 'CandlestickSeries'
export const ColorType = { Solid: 'solid' } as const
