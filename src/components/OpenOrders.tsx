import { useCallback, useEffect, useState } from 'react'
import type { Instrument } from '../lib/instruments'
import { findInstrument, formatPrice, formatQuantity } from '../lib/instruments'
import { cancelOrder, fetchOrders, isCancellable, type Order } from '../lib/orders'
import { describeCancelOutcome, type Feedback } from '../lib/orderFeedback'
import { FeedbackNotice } from './FeedbackNotice'

export interface OpenOrdersProps {
  /**
   * All instruments, not the selected one: the history can hold orders for any
   * instrument, and each must be formatted with ITS OWN scale. Formatting them
   * all with the currently-selected instrument's scale would silently misprice
   * every row for a different instrument.
   */
  instruments: Instrument[]
  /** Bump to force a refetch (the ticket raises this after a submit). */
  refreshToken: number
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'text-amber-400',
  open: 'text-sky-400',
  partially_filled: 'text-sky-300',
  filled: 'text-green-400',
  cancelled: 'text-slate-400',
  rejected: 'text-red-400',
}

export function OpenOrders({ instruments, refreshToken }: OpenOrdersProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrders(await fetchOrders())
      setLoadError(false)
    } catch {
      // Say so rather than sitting on "Loading orders…" forever — an
      // unreachable API must not look like an account with no orders.
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  async function handleCancel(order: Order) {
    setCancelling(order.id)
    try {
      const outcome = await cancelOrder(order.id)
      setFeedback(describeCancelOutcome(outcome))

      if (outcome.kind === 'cancelled') {
        // Trust the returned row — it carries the engine's terminal state.
        setOrders((current) =>
          current.map((o) => (o.id === outcome.order.id ? outcome.order : o)),
        )
      } else if (outcome.kind === 'not_cancellable') {
        // Our view of this order is stale by definition; refetch rather than
        // guess what it became.
        await load()
      }
      // 502 leaves the order genuinely unchanged — nothing to update.
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Could not reach the API',
        detail: 'The cancel request never completed; the order is unchanged.',
      })
    } finally {
      setCancelling(null)
    }
  }

  return (
    <section
      aria-label="Orders"
      className="rounded border border-edge bg-surface-raised"
    >
      <h2 className="border-b border-edge px-3 py-2 text-sm font-medium text-slate-200">
        Orders
      </h2>

      <div className="flex flex-col gap-2 p-3">
        {feedback && <FeedbackNotice feedback={feedback} />}

        {loadError && orders.length === 0 ? (
          <p className="text-sm text-amber-400">
            Could not load your orders — the API is unreachable.
          </p>
        ) : loading && orders.length === 0 ? (
          <p className="text-sm text-slate-500">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-slate-500">No orders yet.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm tabular-nums">
            {orders.map((order) => {
              // Each row is formatted with its OWN instrument's scales. The
              // endpoint returns inactive instruments too, so a historical
              // order still resolves; an unknown id falls back to the raw
              // integer rather than scaling it by a number we don't have.
              const rowInstrument = findInstrument(instruments, order.instrument_id)
              return (
              <li
                key={order.id}
                className="flex items-center justify-between gap-2 rounded border border-edge px-2 py-1"
              >
                <span className="flex flex-col">
                  <span className="text-slate-200">
                    <span
                      className={
                        order.side === 'buy' ? 'text-green-400' : 'text-red-400'
                      }
                    >
                      {order.side === 'buy' ? 'Buy' : 'Sell'}
                    </span>{' '}
                    {rowInstrument
                      ? formatQuantity(order.quantity, rowInstrument.quantityScale)
                      : order.quantity}{' '}
                    {rowInstrument?.symbol ?? order.instrument_id}
                    {order.price !== null && (
                      <>
                        {' @ '}
                        {rowInstrument
                          ? formatPrice(order.price, rowInstrument.priceScale)
                          : order.price}
                      </>
                    )}
                  </span>
                  <span className={`text-xs ${STATUS_STYLES[order.status] ?? 'text-slate-400'}`}>
                    {order.status.replace('_', ' ')}
                    {order.filled_quantity > 0 &&
                      ` · ${order.filled_quantity}/${order.quantity} filled`}
                  </span>
                </span>

                {isCancellable(order) && (
                  <button
                    type="button"
                    onClick={() => void handleCancel(order)}
                    disabled={cancelling === order.id}
                    aria-label={`Cancel order ${order.id}`}
                    className="rounded border border-edge px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                  >
                    {cancelling === order.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
