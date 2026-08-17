/**
 * Order book depth, straight from the engine's `depth` snapshot broadcast.
 * The engine sends a FULL snapshot on every depth-changing event (no diffs), so
 * this component just renders the latest one — no reconciliation to get wrong.
 *
 * `bids` are best (highest) first and `asks` best (lowest) first, per
 * `BookSnapshot` in the engine's `engine/types.ts`.
 */

import type { PriceLevel } from '../lib/streamMessages'
import { formatPrice } from '../lib/instruments'
import { config } from '../lib/config'

export interface DepthLadderProps {
  bids: PriceLevel[]
  asks: PriceLevel[]
  priceScale: number
  hasDepth: boolean
}

const VISIBLE_LEVELS = config.visibleDepthLevels

function Side({
  levels,
  priceScale,
  side,
  maxQuantity,
}: {
  levels: PriceLevel[]
  priceScale: number
  side: 'bid' | 'ask'
  maxQuantity: number
}) {
  const isBid = side === 'bid'
  return (
    <ol
      aria-label={isBid ? 'Bids' : 'Asks'}
      className="flex flex-col gap-px text-sm tabular-nums"
    >
      {levels.map((level) => (
        <li
          key={level.price}
          className="relative flex justify-between px-2 py-0.5"
        >
          {/* Depth bar — proportional to the largest level on show. */}
          <span
            aria-hidden="true"
            className={`absolute inset-y-0 ${isBid ? 'right-0' : 'left-0'} ${
              isBid ? 'bg-up/15' : 'bg-down/15'
            }`}
            style={{
              width: `${maxQuantity > 0 ? (level.quantity / maxQuantity) * 100 : 0}%`,
            }}
          />
          <span
            className={`relative ${isBid ? 'text-green-400' : 'text-red-400'}`}
          >
            {formatPrice(level.price, priceScale)}
          </span>
          <span className="relative text-slate-300">{level.quantity}</span>
        </li>
      ))}
    </ol>
  )
}

export function DepthLadder({
  bids,
  asks,
  priceScale,
  hasDepth,
}: DepthLadderProps) {
  const topBids = bids.slice(0, VISIBLE_LEVELS)
  const topAsks = asks.slice(0, VISIBLE_LEVELS)
  const maxQuantity = Math.max(
    0,
    ...topBids.map((l) => l.quantity),
    ...topAsks.map((l) => l.quantity),
  )

  return (
    <section
      aria-label="Order book"
      className="rounded border border-edge bg-surface-raised"
    >
      <h2 className="border-b border-edge px-3 py-2 text-sm font-medium text-slate-200">
        Order book
      </h2>

      {!hasDepth ? (
        // "Not yet received" is a different fact from "no resting orders", and
        // the two must not look alike.
        <p className="px-3 py-4 text-sm text-slate-500">
          Waiting for the first depth snapshot…
        </p>
      ) : topBids.length === 0 && topAsks.length === 0 ? (
        <p className="px-3 py-4 text-sm text-slate-500">
          No resting orders on either side.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-2">
          <div>
            <h3 className="px-2 pb-1 text-xs uppercase tracking-wide text-slate-500">
              Bids
            </h3>
            <Side
              levels={topBids}
              priceScale={priceScale}
              side="bid"
              maxQuantity={maxQuantity}
            />
          </div>
          <div>
            <h3 className="px-2 pb-1 text-xs uppercase tracking-wide text-slate-500">
              Asks
            </h3>
            <Side
              levels={topAsks}
              priceScale={priceScale}
              side="ask"
              maxQuantity={maxQuantity}
            />
          </div>
        </div>
      )}
    </section>
  )
}
