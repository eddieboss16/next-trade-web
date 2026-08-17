import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const TRADER = {
  id: 1,
  name: 'Trader',
  email: 'trader@example.com',
  account_id: 'acct-1',
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // The protected route is the live trading view, which opens a socket on mount.
  installFakeWebSocket(vi.stubGlobal)
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('login screen', () => {
  it('primes CSRF, logs in, and lands on the route the guard bounced from', async () => {
    const requested: string[] = []
    let session = false

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input)).pathname
      requested.push(url)
      switch (url) {
        case '/api/user':
          return session
            ? json(TRADER, 200)
            : json({ message: 'Unauthenticated.' }, 401)
        case '/sanctum/csrf-cookie':
          document.cookie = 'XSRF-TOKEN=csrf-token-value'
          return new Response(null, { status: 204 })
        case '/api/login':
          session = true
          return json(TRADER, 200)
        // The trading view loads the order list and instrument scales on mount.
        case '/api/orders':
          return json([], 200)
        case '/api/instruments':
          return json(API_INSTRUMENTS, 200)
        default:
          throw new Error(`Unexpected request: ${url}`)
      }
    })

    // Start on the protected route so the redirect-then-return path is exercised.
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: /sign in/i })

    await userEvent.type(screen.getByLabelText(/email/i), TRADER.email)
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByRole('heading', { name: /order book/i }),
    ).toBeInTheDocument()

    // The CSRF prime happened, and it happened before the credentials POST.
    expect(requested.indexOf('/sanctum/csrf-cookie')).toBeGreaterThan(-1)
    expect(requested.indexOf('/sanctum/csrf-cookie')).toBeLessThan(
      requested.indexOf('/api/login'),
    )
  })

  it('reports a rejected login legibly instead of failing silently', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input)).pathname
      switch (url) {
        case '/api/user':
          return json({ message: 'Unauthenticated.' }, 401)
        case '/sanctum/csrf-cookie':
          document.cookie = 'XSRF-TOKEN=csrf-token-value'
          return new Response(null, { status: 204 })
        case '/api/login':
          return json(
            {
              message: 'These credentials do not match our records.',
              errors: {
                email: ['These credentials do not match our records.'],
              },
            },
            422,
          )
        // The trading view loads the order list and instrument scales on mount.
        case '/api/orders':
          return json([], 200)
        case '/api/instruments':
          return json(API_INSTRUMENTS, 200)
        default:
          throw new Error(`Unexpected request: ${url}`)
      }
    })

    renderAt('/login')
    await screen.findByRole('heading', { name: /sign in/i })

    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /do not match our records/i,
    )
    expect(
      screen.queryByRole('heading', { name: /order book/i }),
    ).not.toBeInTheDocument()
  })

  it('returns the user to login after signing out', async () => {
    let session = true
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input)).pathname
      switch (url) {
        case '/api/user':
          return session
            ? json(TRADER, 200)
            : json({ message: 'Unauthenticated.' }, 401)
        case '/sanctum/csrf-cookie':
          document.cookie = 'XSRF-TOKEN=csrf-token-value'
          return new Response(null, { status: 204 })
        case '/api/logout':
          session = false
          return new Response(null, { status: 204 })
        // The trading view loads the order list and instrument scales on mount.
        case '/api/orders':
          return json([], 200)
        case '/api/instruments':
          return json(API_INSTRUMENTS, 200)
        default:
          throw new Error(`Unexpected request: ${url}`)
      }
    })

    renderAt('/dashboard')
    await screen.findByRole('heading', { name: /order book/i })

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(
      await screen.findByRole('heading', { name: /sign in/i }),
    ).toBeInTheDocument()
  })
})
