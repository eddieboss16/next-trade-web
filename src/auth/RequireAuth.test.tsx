import { render, screen, waitFor } from '@testing-library/react'
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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('route guard (spec §1 required test)', () => {
  it('redirects an unauthenticated user from a protected route to the login screen', async () => {
    // Sanctum's answer for "no valid session cookie".
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/user')) {
        return json({ message: 'Unauthenticated.' }, 401)
      }
      if (url.endsWith('/api/instruments')) return json(API_INSTRUMENTS, 200)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderAt('/dashboard')

    // Lands on login...
    expect(
      await screen.findByRole('heading', { name: /sign in/i }),
    ).toBeInTheDocument()

    // ...as a usable screen, not a blank or broken one.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()

    // And the protected page never rendered.
    expect(
      screen.queryByRole('heading', { name: /order book/i }),
    ).not.toBeInTheDocument()
  })

  it('shows a visible checking state instead of a blank page while the session resolves', async () => {
    // Defer ONLY the session check: instruments load in parallel, and letting
    // them share the deferred promise would hand `resolveUser` to whichever
    // request happened to run last.
    let resolveUser: (response: Response) => void = () => {}
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/instruments')) return json(API_INSTRUMENTS, 200)
      return new Promise<Response>((resolve) => {
        resolveUser = resolve
      })
    })

    renderAt('/dashboard')

    const checking = await screen.findByRole('status')
    expect(checking).toHaveTextContent(/checking your session/i)

    resolveUser(json({ message: 'Unauthenticated.' }, 401))

    expect(
      await screen.findByRole('heading', { name: /sign in/i }),
    ).toBeInTheDocument()
  })

  it('lets an authenticated user through to the protected route', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/user')) {
        return json({ id: 1, name: 'Trader', email: 'trader@example.com', account_id: 'acct-1' }, 200)
      }
      // The trading view loads the order list and instrument scales on mount.
      if (url.endsWith('/api/orders')) return json([], 200)
      if (url.endsWith('/api/instruments')) return json(API_INSTRUMENTS, 200)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderAt('/dashboard')

    expect(
      await screen.findByRole('heading', { name: /order book/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('trader@example.com')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /sign in/i }),
    ).not.toBeInTheDocument()
  })

  it('sends the session cookie when checking the session', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Unauthenticated.' }, 401))

    renderAt('/dashboard')
    await screen.findByRole('heading', { name: /sign in/i })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.credentials).toBe('include')
  })
})
