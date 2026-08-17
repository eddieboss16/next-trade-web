// @vitest-environment node
// Pure mapping — no DOM needed.
import { describe, expect, it } from 'vitest'
import { describeCancelOutcome, describeSubmitOutcome } from './orderFeedback'
import type { CancelOutcome, Order, SubmitOutcome } from './orders'

const ORDER: Order = {
  id: 'order-1',
  instrument_id: 'AAPL',
  account_id: 'acct-1',
  side: 'buy',
  type: 'limit',
  price: 15025,
  quantity: 10,
  filled_quantity: 0,
  status: 'open',
  sequence: 42,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

/**
 * Every outcome the contract can produce. Typed as the union, so adding a
 * variant to `SubmitOutcome` without adding it here is a type error — the list
 * cannot silently fall behind the contract.
 */
const SUBMIT_OUTCOMES: SubmitOutcome[] = [
  { kind: 'accepted', order: { ...ORDER, status: 'open' } },
  { kind: 'accepted', order: { ...ORDER, status: 'filled', filled_quantity: 10 } },
  { kind: 'accepted', order: { ...ORDER, status: 'partially_filled', filled_quantity: 4 } },
  { kind: 'replayed', order: ORDER },
  {
    kind: 'insufficient_margin',
    projectedMarginLevelPct: 87.5,
    requiredMinPct: 100,
    message: 'Order rejected: would breach the minimum margin level.',
  },
  {
    kind: 'engine_rejected',
    reason: 'insufficient liquidity',
    orderId: ORDER.id,
    message: 'Order rejected by the engine.',
  },
  {
    kind: 'invalid',
    errors: { quantity: ['The quantity must be at least 1.'] },
    message: 'The given data was invalid.',
  },
  { kind: 'duplicate', orderId: ORDER.id, message: 'Duplicate order id.' },
  { kind: 'no_account', message: 'No trading account for this user.' },
  { kind: 'order_id_in_use', message: 'Order id already in use.' },
  { kind: 'conflict', message: 'Some future 409 nobody has seen.' },
  {
    kind: 'engine_unavailable',
    orderId: ORDER.id,
    message: 'Trading engine is unavailable.',
  },
  { kind: 'price_unavailable', message: 'No price available.' },
  { kind: 'unauthenticated', message: 'Unauthenticated.' },
  { kind: 'unexpected', status: 418, message: 'Teapot.' },
]

const CANCEL_OUTCOMES: CancelOutcome[] = [
  { kind: 'cancelled', order: { ...ORDER, status: 'cancelled' } },
  { kind: 'forbidden', message: 'This action is unauthorized.' },
  { kind: 'not_cancellable', orderId: ORDER.id, message: 'Not cancellable.' },
  { kind: 'engine_unavailable', orderId: ORDER.id, message: 'Engine unavailable.' },
  { kind: 'unauthenticated', message: 'Unauthenticated.' },
  { kind: 'unexpected', status: 500, message: 'Server error.' },
]

describe('submit feedback (spec §3: distinct state per outcome)', () => {
  it('gives every outcome its own headline — none collapse together', () => {
    const titles = SUBMIT_OUTCOMES.map((o) => describeSubmitOutcome(o).title)
    expect(new Set(titles).size).toBe(SUBMIT_OUTCOMES.length)
  })

  it('never produces an empty or placeholder headline', () => {
    for (const outcome of SUBMIT_OUTCOMES) {
      const feedback = describeSubmitOutcome(outcome)
      expect(feedback.title.length).toBeGreaterThan(0)
      expect(feedback.detail.length).toBeGreaterThan(0)
      expect(feedback.title).not.toMatch(/something went wrong|unknown error/i)
    }
  })

  it('separates a margin rejection from an engine rejection in both tone and words', () => {
    const margin = describeSubmitOutcome({
      kind: 'insufficient_margin',
      projectedMarginLevelPct: 87.5,
      requiredMinPct: 100,
      message: 'Order rejected: would breach the minimum margin level.',
    })
    const engine = describeSubmitOutcome({
      kind: 'engine_rejected',
      reason: 'insufficient liquidity',
      orderId: ORDER.id,
      message: 'Order rejected by the engine.',
    })

    expect(margin.title).not.toBe(engine.title)
    expect(margin.tone).not.toBe(engine.tone)
    // The margin case carries the actual numbers the backend computed.
    expect(margin.detail).toMatch(/87\.5/)
    expect(margin.detail).toMatch(/100/)
    // And says the engine was never involved, rather than implying it rejected it.
    expect(margin.hint).toMatch(/never sent to the engine/i)
    expect(engine.detail).toMatch(/insufficient liquidity/i)
  })

  it('tells the user a 502 order EXISTS and must not be resubmitted', () => {
    // The single most dangerous outcome to render as a generic failure: the
    // order was persisted as pending, so a blind retry creates a second one.
    const feedback = describeSubmitOutcome({
      kind: 'engine_unavailable',
      orderId: ORDER.id,
      message: 'Trading engine is unavailable; your order is saved as pending.',
    })

    expect(feedback.title).toMatch(/pending/i)
    expect(feedback.detail).toMatch(/not rejected/i)
    // The copy must match the actual guard: the key is kept on a 502, so an
    // identical resubmit replays rather than duplicating.
    expect(feedback.hint).toMatch(/replays this order rather than creating a second/i)
    // Not styled as a hard failure — the order is alive.
    expect(feedback.tone).toBe('warning')
  })

  it('distinguishes the three 201 fill states', () => {
    const titles = SUBMIT_OUTCOMES.filter((o) => o.kind === 'accepted').map(
      (o) => describeSubmitOutcome(o).title,
    )
    expect(new Set(titles).size).toBe(3)
  })

  it('surfaces validation messages as field errors, not as prose', () => {
    const feedback = describeSubmitOutcome({
      kind: 'invalid',
      errors: { price: ['The price field is prohibited when type is market.'] },
      message: 'The given data was invalid.',
    })
    expect(feedback.fieldErrors?.price[0]).toMatch(/prohibited/i)
  })

  it('keeps all three 409 outcomes visually distinct', () => {
    const titles = SUBMIT_OUTCOMES.filter(
      (o) =>
        o.kind === 'duplicate' ||
        o.kind === 'no_account' ||
        o.kind === 'order_id_in_use' ||
        o.kind === 'conflict',
    ).map((o) => describeSubmitOutcome(o).title)

    expect(titles).toHaveLength(4)
    expect(new Set(titles).size).toBe(4)
  })

  it('marks an undocumented status as unexpected rather than guessing', () => {
    const feedback = describeSubmitOutcome({
      kind: 'unexpected',
      status: 418,
      message: 'Teapot.',
    })
    expect(feedback.title).toMatch(/418/)
    expect(feedback.detail).toMatch(/not in the documented contract/i)
  })
})

describe('cancel feedback (spec §3: same discipline)', () => {
  it('gives every outcome its own headline', () => {
    const titles = CANCEL_OUTCOMES.map((o) => describeCancelOutcome(o).title)
    expect(new Set(titles).size).toBe(CANCEL_OUTCOMES.length)
  })

  it('separates "not yours" (403) from "no longer cancellable" (409)', () => {
    const forbidden = describeCancelOutcome({
      kind: 'forbidden',
      message: 'This action is unauthorized.',
    })
    const stale = describeCancelOutcome({
      kind: 'not_cancellable',
      orderId: ORDER.id,
      message: 'Not cancellable.',
    })

    expect(forbidden.title).not.toBe(stale.title)
    expect(forbidden.tone).not.toBe(stale.tone)
    expect(forbidden.detail).toMatch(/engine was never contacted/i)
  })

  it('says a 502 left the order unchanged and still working', () => {
    const feedback = describeCancelOutcome({
      kind: 'engine_unavailable',
      orderId: ORDER.id,
      message: 'Trading engine is unavailable; the order was not cancelled.',
    })
    expect(feedback.detail).toMatch(/unchanged and still working/i)
    expect(feedback.tone).toBe('warning')
  })
})
