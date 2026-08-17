/**
 * Outcome → UI copy. PURE, so "every documented outcome produces a distinct,
 * correct UI state" is a testable claim rather than a hope.
 *
 * The rule this file exists to enforce: a margin rejection must not look like a
 * generic error, and an engine-unreachable 502 must not look like a validation
 * failure. The backends went to real effort to distinguish these; collapsing
 * them here would throw that work away.
 *
 * The 502 case matters most in practice. It is NOT a rejection — the order was
 * persisted as `pending` and simply never reached the engine. Telling the user
 * "something went wrong" would invite a resubmit that creates a SECOND order.
 */

import type { CancelOutcome, Order, SubmitOutcome } from './orders'

export type FeedbackTone = 'success' | 'info' | 'warning' | 'danger'

export interface Feedback {
  tone: FeedbackTone
  /** Short, distinct headline — no two outcomes share one. */
  title: string
  detail: string
  /** What to do next, where the right move isn't obvious. */
  hint?: string
  /** Per-field validation messages, for a 422 that failed validation. */
  fieldErrors?: Record<string, string[]>
}

function acceptedFeedback(order: Order): Feedback {
  switch (order.status) {
    case 'filled':
      return {
        tone: 'success',
        title: 'Order filled',
        detail: `Filled ${order.filled_quantity} of ${order.quantity}.`,
      }
    case 'partially_filled':
      return {
        tone: 'success',
        title: 'Order partially filled',
        detail: `Filled ${order.filled_quantity} of ${order.quantity}; the remainder is resting in the book.`,
      }
    case 'open':
      return {
        tone: 'success',
        title: 'Order resting',
        detail: `Accepted and resting in the book (${order.quantity} unfilled).`,
      }
    default:
      // 201 with any other status: accepted, but say what it actually is rather
      // than assuming one of the three above.
      return {
        tone: 'success',
        title: 'Order accepted',
        detail: `Accepted with status "${order.status}".`,
      }
  }
}

export function describeSubmitOutcome(outcome: SubmitOutcome): Feedback {
  switch (outcome.kind) {
    case 'accepted':
      return acceptedFeedback(outcome.order)

    case 'replayed':
      return {
        tone: 'info',
        title: 'Already submitted',
        detail:
          'An order with this id was already stored, so it was returned unchanged. Nothing was sent to the engine a second time.',
        hint: 'This is the idempotency guard — a double-submit did not create a second order.',
      }

    case 'insufficient_margin': {
      const numbers =
        outcome.projectedMarginLevelPct !== null && outcome.requiredMinPct !== null
          ? ` It would put your margin level at ${outcome.projectedMarginLevelPct}%, below the required ${outcome.requiredMinPct}%.`
          : ''
      return {
        tone: 'warning',
        title: 'Rejected: insufficient margin',
        detail: `${outcome.message}${numbers}`,
        hint: 'Reduce the quantity or close an open position. The order was never sent to the engine.',
      }
    }

    case 'engine_rejected':
      return {
        tone: 'danger',
        title: 'Rejected by the engine',
        detail: `${outcome.message} Reason: ${outcome.reason}.`,
        hint: 'The engine received this order and refused it; the order is recorded as rejected.',
      }

    case 'invalid':
      return {
        tone: 'warning',
        title: 'Check the order details',
        detail: outcome.message,
        fieldErrors: outcome.errors,
      }

    case 'duplicate':
      return {
        tone: 'danger',
        title: 'Duplicate order id',
        detail: `${outcome.message} The engine already knows this id, so the order was recorded as rejected.`,
      }

    case 'no_account':
      return {
        tone: 'danger',
        title: 'No trading account',
        detail: `${outcome.message} Orders cannot be placed until an account is linked to this user.`,
        hint: 'Nothing was submitted, and nothing was stored — this is not a rejection of the order itself.',
      }

    case 'order_id_in_use':
      return {
        tone: 'danger',
        title: 'Order id already in use',
        detail: `${outcome.message} That id belongs to a different account, so it cannot be reused here.`,
        hint: 'Submitting again will use a fresh id.',
      }

    case 'conflict':
      return {
        tone: 'danger',
        title: 'Order could not be placed',
        detail: `${outcome.message} This 409 matches none of the documented cases.`,
      }

    case 'engine_unavailable':
      return {
        tone: 'warning',
        title: 'Engine unreachable — order saved as pending',
        detail: `${outcome.message} It was NOT rejected, and it was NOT submitted.`,
        hint: 'It stays pending until the engine is reachable. Submitting this same ticket again replays this order rather than creating a second one.',
      }

    case 'price_unavailable':
      return {
        tone: 'warning',
        title: 'No price available',
        detail: `${outcome.message} Margin cannot be checked without a price, so nothing was submitted.`,
        hint: 'Wait for the price feed to deliver a tick for this instrument.',
      }

    case 'unauthenticated':
      return {
        tone: 'danger',
        title: 'Session expired',
        detail: `${outcome.message} Sign in again to place orders.`,
      }

    case 'unexpected':
      return {
        tone: 'danger',
        title: `Unexpected response (${outcome.status})`,
        detail: `${outcome.message} This status is not in the documented contract.`,
      }
  }
}

export function describeCancelOutcome(outcome: CancelOutcome): Feedback {
  switch (outcome.kind) {
    case 'cancelled':
      return {
        tone: 'success',
        title: 'Order cancelled',
        detail: `Order ${outcome.order.id} is now "${outcome.order.status}".`,
      }

    case 'forbidden':
      return {
        tone: 'danger',
        title: 'Not your order',
        detail: `${outcome.message} The engine was never contacted.`,
      }

    case 'not_cancellable':
      return {
        tone: 'warning',
        title: 'No longer cancellable',
        detail: outcome.message,
        hint: 'It may have filled or been cancelled already — refresh the list to see its current state.',
      }

    case 'engine_unavailable':
      return {
        tone: 'warning',
        title: 'Engine unreachable — not cancelled',
        detail: `${outcome.message} The order is unchanged and still working.`,
        hint: 'Try again once the engine is reachable.',
      }

    case 'unauthenticated':
      return {
        tone: 'danger',
        title: 'Session expired',
        detail: `${outcome.message} Sign in again to cancel orders.`,
      }

    case 'unexpected':
      return {
        tone: 'danger',
        title: `Unexpected response (${outcome.status})`,
        detail: `${outcome.message} This status is not in the documented contract.`,
      }
  }
}
