import { useRef, useState, type FormEvent } from 'react'
import { toSmallestUnit, type Instrument } from '../lib/instruments'
import { submitOrder, type Order, type OrderSide, type OrderType } from '../lib/orders'
import { describeSubmitOutcome, type Feedback } from '../lib/orderFeedback'
import { FeedbackNotice } from './FeedbackNotice'

export interface OrderTicketProps {
  instrument: Instrument
  /** Called whenever an outcome may have changed the order list. */
  onOrderChanged?: (order: Order | null) => void
}

/**
 * Order entry. Client-side validation is deliberately shallow — disabling
 * submit on an obviously empty quantity is UX, but margin maths belongs to the
 * backend, which already does it correctly and returns a precise 422.
 */
export function OrderTicket({ instrument, onOrderChanged }: OrderTicketProps) {
  const [side, setSide] = useState<OrderSide>('buy')
  const [type, setType] = useState<OrderType>('limit')
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /*
   * Caller-owned idempotency key, keyed to the ticket's CONTENTS.
   *
   * Laravel's guard is `Order::find($id)`: same id → 200 replay, engine not
   * called, no second row. So the key must survive exactly as long as "the same
   * order request" does — neither longer nor shorter:
   *
   *  - identical ticket resubmitted → REUSE, so a double-click or a retry after
   *    a 502 replays the existing row instead of inserting a second one. This
   *    is what makes the 502 guard structural rather than a plea in the copy.
   *  - ticket edited → MINT, because a different quantity/price is a different
   *    order. Reusing here would replay the OLD order and silently discard the
   *    user's new values.
   *  - after an outcome that stored a terminal row → CLEAR, so a deliberate
   *    repeat of an identical order is allowed to be a second order.
   *
   * A ref, not state: read and written inside one async submit, and it must
   * never be stale across back-to-back submits.
   */
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null)

  // Both fields hold DISPLAY values; the API takes integers in the smallest
  // unit. Validate the CONVERTED values, not the typed ones — 150.25 is not an
  // integer, but the 15025 it converts to is.
  const quantityInteger = toSmallestUnit(quantity, instrument.quantityScale)
  const quantityValid = quantityInteger !== null && quantityInteger >= 1

  const priceInteger = toSmallestUnit(price, instrument.priceScale)
  const priceValid = type === 'market' || (priceInteger !== null && priceInteger >= 1)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !quantityValid || !priceValid) return
    if (quantityInteger === null) return // unreachable given quantityValid; narrows the type

    setSubmitting(true)
    try {
      const priceForOrder = type === 'limit' ? priceInteger : null
      const signature = JSON.stringify([
        instrument.id,
        side,
        type,
        priceForOrder,
        quantityInteger,
      ])
      const previous = idempotencyRef.current
      const key =
        previous && previous.signature === signature
          ? previous.key
          : crypto.randomUUID()
      idempotencyRef.current = { signature, key }

      const outcome = await submitOrder({
        id: key,
        instrument_id: instrument.id,
        side,
        type,
        // Limit orders REQUIRE a price; market orders must OMIT it entirely —
        // the API prohibits the field rather than ignoring it.
        ...(type === 'limit' && priceInteger !== null
          ? { price: priceInteger }
          : {}),
        quantity: quantityInteger,
      })

      setFeedback(describeSubmitOutcome(outcome))

      if (outcome.kind === 'accepted' || outcome.kind === 'replayed') {
        onOrderChanged?.(outcome.order)
        // Terminal and stored: this request is finished, so an identical repeat
        // is allowed to be a genuinely new order.
        idempotencyRef.current = null
      } else if (
        outcome.kind === 'duplicate' ||
        outcome.kind === 'engine_rejected'
      ) {
        // The row was written as `rejected`; that id is spent.
        onOrderChanged?.(null)
        idempotencyRef.current = null
      } else if (outcome.kind === 'order_id_in_use') {
        // The id belongs to another account, so it can never succeed for this
        // user. Keeping it would make every retry hit the same conflict.
        // Nothing was stored for us, so there is no list to refresh.
        idempotencyRef.current = null
      } else if (outcome.kind === 'engine_unavailable') {
        // The order EXISTS as pending even though the engine never saw it, so
        // the list must refresh. The key is deliberately KEPT: if the user
        // ignores the warning and submits the same ticket again, Laravel finds
        // this id and replays it (200) instead of inserting a second pending
        // order. Rotating here would make that duplicate possible.
        onOrderChanged?.(null)
      }
      // Everything else (margin, validation, price, auth) stored nothing, so the
      // key is also kept — and edits to the ticket mint a new one anyway via the
      // signature check above.
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Could not reach the API',
        detail:
          'The request never completed, so the order may or may not have been received.',
        hint: 'Check the order list before resubmitting.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      aria-label="Order ticket"
      className="rounded border border-edge bg-surface-raised"
    >
      <h2 className="border-b border-edge px-3 py-2 text-sm font-medium text-slate-200">
        New order
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="side" className="block text-xs text-slate-400">
              Side
            </label>
            <select
              id="side"
              value={side}
              onChange={(event) => setSide(event.target.value as OrderSide)}
              className="mt-1 w-full rounded border border-edge bg-surface px-2 py-1 text-sm text-slate-100"
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>

          <div>
            <label htmlFor="type" className="block text-xs text-slate-400">
              Type
            </label>
            <select
              id="type"
              value={type}
              onChange={(event) => setType(event.target.value as OrderType)}
              className="mt-1 w-full rounded border border-edge bg-surface px-2 py-1 text-sm text-slate-100"
            >
              <option value="limit">Limit</option>
              <option value="market">Market</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="quantity" className="block text-xs text-slate-400">
            Quantity
          </label>
          {/* type="text" for the same reason as price: a controlled number
              input reports an intermediate "1." as empty and mangles decimals.
              Harmless at quantityScale 0, correct if it is ever raised. */}
          <input
            id="quantity"
            name="quantity"
            type="text"
            inputMode={instrument.quantityScale > 0 ? 'decimal' : 'numeric'}
            autoComplete="off"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="mt-1 w-full rounded border border-edge bg-surface px-2 py-1 text-sm tabular-nums text-slate-100"
          />
        </div>

        {type === 'limit' && (
          <div>
            <label htmlFor="price" className="block text-xs text-slate-400">
              Limit price
            </label>
            {/*
              Deliberately type="text" + inputMode="decimal", not type="number".
              A controlled number input reports the intermediate "150." as an
              empty value, so typing a decimal price mangles it. Prices here are
              decimals by definition, so the numeric keypad without the number
              input's parsing is the correct trade.
            */}
            <input
              id="price"
              name="price"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="mt-1 w-full rounded border border-edge bg-surface px-2 py-1 text-sm tabular-nums text-slate-100"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !quantityValid || !priceValid}
          className="rounded bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${instrument.symbol}`}
        </button>

        {feedback && <FeedbackNotice feedback={feedback} />}
      </form>
    </section>
  )
}
