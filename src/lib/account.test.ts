import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAccount,
  formatMarginLevel,
  formatMoney,
  type Account,
} from './account'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ACCOUNT: Account = {
  id: 'acct-1',
  name: 'Main',
  balance: 1_000_000,
  equity: 1_025_050,
  used_margin: 250_000,
  free_margin: 775_050,
  margin_level_pct: 410.02,
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAccount — outcomes stay distinct', () => {
  it('200 → ok with the live figures', async () => {
    fetchMock.mockResolvedValue(json(ACCOUNT, 200))
    const outcome = await fetchAccount('acct-1')

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('narrowing')
    expect(outcome.account.equity).toBe(1_025_050)
  })

  it('503 → price_unavailable, its own outcome (spec §4 required test)', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          message: 'Cannot compute margin/equity: no current price for an instrument.',
          reason: 'price_unavailable',
        },
        503,
      ),
    )
    const outcome = await fetchAccount('acct-1')

    expect(outcome.kind).toBe('price_unavailable')
  })

  it('403 → forbidden, not confused with 404', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Forbidden.' }, 403))
    expect((await fetchAccount('acct-1')).kind).toBe('forbidden')
  })

  it('404 → not_found', async () => {
    fetchMock.mockResolvedValue(json({}, 404))
    expect((await fetchAccount('acct-1')).kind).toBe('not_found')
  })

  it('401 → unauthenticated', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Unauthenticated.' }, 401))
    expect((await fetchAccount('acct-1')).kind).toBe('unauthenticated')
  })

  it('a network failure → unreachable, not a crash', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await fetchAccount('acct-1')).kind).toBe('unreachable')
  })

  it('an undocumented status → unexpected', async () => {
    fetchMock.mockResolvedValue(json({}, 500))
    const outcome = await fetchAccount('acct-1')

    expect(outcome.kind).toBe('unexpected')
    if (outcome.kind !== 'unexpected') throw new Error('narrowing')
    expect(outcome.status).toBe(500)
  })

  it('sends credentials so the session cookie authenticates the request', async () => {
    fetchMock.mockResolvedValue(json(ACCOUNT, 200))
    await fetchAccount('acct-1')

    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/accounts/acct-1')
  })
})

describe('money formatting', () => {
  it('renders integer cents as a decimal amount', () => {
    // 1,025,050 cents is 10,250.50 — not 1,025,050.
    expect(formatMoney(1_025_050)).toBe('10,250.50')
    expect(formatMoney(0)).toBe('0.00')
    expect(formatMoney(-4550)).toBe('-45.50')
  })

  it('distinguishes a null margin level from 0%', () => {
    // Null means used margin is 0 — no open positions, i.e. the HEALTHIEST
    // state. Rendering it as 0% would read as the worst possible one.
    expect(formatMarginLevel(null)).toBe('—')
    expect(formatMarginLevel(0)).toBe('0.00%')
    expect(formatMarginLevel(410.02)).toBe('410.02%')
  })
})
