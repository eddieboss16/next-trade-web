/**
 * `lightweight-charts` wrapper. Holds no market state of its own — it renders
 * whatever `toChartData` produces, gaps included.
 */

import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import type { Candle } from '../lib/streamMessages'
import { toChartData } from '../lib/chartData'

export interface CandleChartProps {
  candles: Candle[]
  priceScale: number
}

export function CandleChart({ candles, priceScale }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0f17' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      autoSize: true,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
      borderVisible: false,
      priceFormat: {
        type: 'price',
        precision: priceScale,
        minMove: 1 / 10 ** priceScale,
      },
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [priceScale])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    // setData (not update) on every change: the series is a pure projection of
    // reducer state, and whitespace gap slots have to be re-derived alongside
    // the candles anyway.
    series.setData(toChartData(candles, { priceScale }))
  }, [candles, priceScale])

  return (
    <div
      ref={containerRef}
      data-testid="candle-chart"
      className="h-full w-full"
    />
  )
}
