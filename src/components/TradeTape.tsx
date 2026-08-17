/**
 * Recent trade prints from the engine's `trade` broadcast. A partial fill emits
 * a trade without any other event, so this is the most direct evidence the
 * stream is alive.
 */

import type { TradePrint } from '../lib/streamMessages'
import { formatPrice } from '../lib/instruments'
import { config } from '../lib/config'

export interface TradeTapeProps {
  trades: TradePrint[]
  priceScale: number
}

const VISIBLE_TRADES = config.visibleTrades

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function TradeTape({ trades, priceScale }: TradeTapeProps) {
  return (
    <section
      aria-label="Recent trades"
      className="rounded border border-edge bg-surface-raised"
    >
      <h2 className="border-b border-edge px-3 py-2 text-sm font-medium text-slate-200">
        Recent trades
      </h2>

      {trades.length === 0 ? (
        <p className="px-3 py-4 text-sm text-slate-500">No trades yet.</p>
      ) : (
        <ol className="flex flex-col gap-px p-2 text-sm tabular-nums">
          {trades.slice(0, VISIBLE_TRADES).map((trade) => (
            <li
              key={`${trade.timestamp}-${trade.price}-${trade.quantity}`}
              className="flex justify-between px-2 py-0.5"
            >
              <span className="text-slate-500">
                {timeFormat.format(new Date(trade.timestamp))}
              </span>
              <span className="text-slate-200">
                {formatPrice(trade.price, priceScale)}
              </span>
              <span className="text-slate-400">{trade.quantity}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
