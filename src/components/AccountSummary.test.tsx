import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSummary } from './AccountSummary'
import type { Account } from '../lib/account'

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

const NO_PRICE = {
  message: 'Cannot compute margin/equity: no current price for an instrument.',
  reason: 'price_unavailable',
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('503 no-price-available account state (spec §4 required test)', () => {
  it('renders legibly — not a crash, not a blank panel', async () => {
    fetchMock.mockResolvedValue(json(NO_PRICE, 503))
    render(<AccountSummary accountId="acct-1" />)

    const notice = await screen.findByRole('status')

    // Named as its own state, not a generic failure.
    expect(notice).toHaveAttribute('data-outcome', 'price_unavailable')
    expect(within(notice).getByTestId('account-problem-title')).toHaveTextContent(
      /no current price/i,
    )
    // Explains WHY the figures are missing, rather than showing an empty panel.
    expect(notice).toHaveTextContent(/open position in an instrument with no current price/i)
    expect(notice).toHaveTextContent(/cannot be marked to market/i)

    // The panel is still there and still labelled.
    expect(screen.getByRole('heading', { name: /account/i })).toBeInTheDocument()
    // And crucially: no fabricated zeroes standing in for the real figures.
    expect(screen.queryByText('0.00')).not.toBeInTheDocument()
  })

  it('keeps the last good figures on screen, explicitly labelled as stale', async () => {
    // A 200 first, then a poll degrades to 503. Blanking the numbers the user
    // was just reading would be worse than showing them as possibly stale.
    fetchMock
      .mockResolvedValueOnce(json(ACCOUNT, 200))
      .mockResolvedValue(json(NO_PRICE, 503))

    const { rerender } = render(
      <AccountSummary accountId="acct-1" refreshToken={0} />,
    )
    expect(await screen.findByText('10,250.50')).toBeInTheDocument()

    // Same component instance, forced to refetch — this is the poll's path.
    await act(async () => {
      rerender(<AccountSummary accountId="acct-1" refreshToken={1} />)
    })

    const notice = await screen.findByRole('status')
    expect(notice).toHaveAttribute('data-outcome', 'price_unavailable')
    // The figures survive, and are labelled as possibly out of date.
    expect(screen.getByText('10,250.50')).toBeInTheDocument()
    expect(screen.getByText(/may now be out of date/i)).toBeInTheDocument()
  })

  it('does not throw when the 503 arrives before any good response', async () => {
    fetchMock.mockResolvedValue(json(NO_PRICE, 503))
    expect(() => render(<AccountSummary accountId="acct-1" />)).not.toThrow()
    await screen.findByRole('status')
  })
})

describe('account metrics', () => {
  it('renders every figure from the contract, scaled from integer cents', async () => {
    fetchMock.mockResolvedValue(json(ACCOUNT, 200))
    render(<AccountSummary accountId="acct-1" />)

    expect(await screen.findByText('10,000.00')).toBeInTheDocument() // balance
    expect(screen.getByText('10,250.50')).toBeInTheDocument() // equity
    expect(screen.getByText('2,500.00')).toBeInTheDocument() // used margin
    expect(screen.getByText('7,750.50')).toBeInTheDocument() // free margin
    expect(screen.getByText('410.02%')).toBeInTheDocument() // margin level
  })

  it('shows a null margin level as "no open positions", not 0%', async () => {
    fetchMock.mockResolvedValue(
      json({ ...ACCOUNT, used_margin: 0, margin_level_pct: null }, 200),
    )
    render(<AccountSummary accountId="acct-1" />)

    expect(await screen.findByText(/no open positions/i)).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument()
  })

  it('renders a 403 differently from the 503 — not all problems look alike', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Forbidden.' }, 403))
    render(<AccountSummary accountId="someone-elses" />)

    const notice = await screen.findByRole('status')
    expect(notice).toHaveAttribute('data-outcome', 'forbidden')
    expect(within(notice).getByTestId('account-problem-title')).toHaveTextContent(
      /not your account/i,
    )
  })

  it('reports an unreachable API rather than showing an empty account', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<AccountSummary accountId="acct-1" />)

    const notice = await screen.findByRole('status')
    expect(notice).toHaveAttribute('data-outcome', 'unreachable')
  })
})
