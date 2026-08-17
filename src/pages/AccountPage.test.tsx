import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AppProviders } from '../AppProviders'
import { installFakeWebSocket } from '../test/fakeWebSocket'
import { API_INSTRUMENTS } from '../test/renderApp'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ACCOUNT = {
  id: 'acct-1',
  name: 'Main',
  balance: 1_000_000,
  equity: 1_025_050,
  used_margin: 250_000,
  free_margin: 775_050,
  margin_level_pct: 410.02,
}

/** Records every account id the page asked for. */
const requestedAccountIds: string[] = []

function setupApi(accountId: string | null) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input)).pathname

    if (url === '/api/user') {
      return json(
        { id: 1, name: 'Trader', email: 'trader@example.com', account_id: accountId },
        200,
      )
    }
    if (url === '/api/instruments') return json(API_INSTRUMENTS, 200)
    if (url === '/api/orders') return json([], 200)
    if (url.startsWith('/api/accounts/')) {
      requestedAccountIds.push(url.replace('/api/accounts/', ''))
      return json(ACCOUNT, 200)
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

function renderAccountPage() {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  requestedAccountIds.length = 0
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  installFakeWebSocket(vi.stubGlobal)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('account id comes from the user payload', () => {
  it('reads account_id off GET /api/user and fetches that account', async () => {
    setupApi('acct-1')
    renderAccountPage()

    expect(await screen.findByText('10,250.50')).toBeInTheDocument()
    expect(requestedAccountIds).toEqual(['acct-1'])
  })

  it('never derives the id from order history — no such request is made', async () => {
    // The old fallback read orders[0].account_id. The id now arrives on the
    // user, so the account loads without the order list being consulted first.
    setupApi('acct-99')
    renderAccountPage()

    await screen.findByText('10,250.50')
    expect(requestedAccountIds).toEqual(['acct-99'])
  })

  it('states plainly when the user has no account linked (account_id null)', async () => {
    // Null is a real state, not a failed lookup.
    setupApi(null)
    renderAccountPage()

    expect(
      await screen.findByText(/no trading account linked/i),
    ).toBeInTheDocument()
    // And no account request was attempted with a bogus id.
    expect(requestedAccountIds).toEqual([])
  })
})
