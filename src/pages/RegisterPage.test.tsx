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

/** The user the API returns from a successful registration — with `account_id`. */
const NEW_USER = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  account_id: 'acct-new',
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

/**
 * Handles everything the app requests apart from `POST /api/register`, which each
 * test supplies. `session` starts false so the app resolves to logged-out and
 * renders the sign-up screen.
 */
function routes(onRegister: () => Response, session = { value: false }) {
  return async (input: RequestInfo | URL) => {
    const url = new URL(String(input)).pathname
    switch (url) {
      case '/api/user':
        return session.value
          ? json(NEW_USER, 200)
          : json({ message: 'Unauthenticated.' }, 401)
      case '/sanctum/csrf-cookie':
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      case '/api/register':
        return onRegister()
      // The dashboard loads the order list and instrument scales on mount.
      case '/api/orders':
        return json([], 200)
      case '/api/instruments':
        return json(API_INSTRUMENTS, 200)
      default:
        throw new Error(`Unexpected request: ${url}`)
    }
  }
}

async function fillForm(password = 'password123', confirmation = password) {
  await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace')
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.type(screen.getByLabelText('Confirm password'), confirmation)
  await userEvent.click(screen.getByRole('button', { name: /create account/i }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // The dashboard is the live trading view, which opens a socket on mount.
  installFakeWebSocket(vi.stubGlobal)
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sign-up screen', () => {
  /** Required test #5. */
  it('primes CSRF, registers, and lands on the dashboard like a login does', async () => {
    const requested: string[] = []
    const session = { value: false }

    fetchMock.mockImplementation(async (input) => {
      requested.push(new URL(String(input)).pathname)
      return routes(() => {
        // The API establishes the session itself and answers 201, not 200.
        session.value = true
        return json(NEW_USER, 201)
      }, session)(input)
    })

    renderAt('/register')
    await screen.findByRole('heading', { name: /create account/i })

    await fillForm()

    expect(
      await screen.findByRole('heading', { name: /order book/i }),
    ).toBeInTheDocument()

    // The CSRF prime happened, and it happened before the registration POST —
    // same contract as login, with no separate step for the caller.
    expect(requested.indexOf('/sanctum/csrf-cookie')).toBeGreaterThan(-1)
    expect(requested.indexOf('/sanctum/csrf-cookie')).toBeLessThan(
      requested.indexOf('/api/register'),
    )
  })

  /** Required test #6. */
  it('renders a duplicate email as its own message, not the generic error', async () => {
    fetchMock.mockImplementation(
      routes(() =>
        json(
          {
            message: 'The email has already been taken.',
            errors: { email: ['The email has already been taken.'] },
          },
          422,
        ),
      ),
    )

    renderAt('/register')
    await screen.findByRole('heading', { name: /create account/i })

    await fillForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/account already exists with that email/i)

    // The distinguishing treatment: this is not a "try again" failure, so the
    // user is offered the way out instead.
    expect(
      screen.getByRole('link', { name: /sign in instead/i }),
    ).toBeInTheDocument()

    // And it did not silently succeed.
    expect(
      screen.queryByRole('heading', { name: /order book/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps ordinary validation errors distinct from the duplicate-email case', async () => {
    // Same 422 status, different story — this is what makes the test above
    // meaningful rather than "any 422 shows the duplicate message".
    fetchMock.mockImplementation(
      routes(() =>
        json(
          {
            message: 'The password field confirmation does not match.',
            errors: {
              password: ['The password field confirmation does not match.'],
            },
          },
          422,
        ),
      ),
    )

    renderAt('/register')
    await screen.findByRole('heading', { name: /create account/i })

    await fillForm('password123', 'password456')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/confirmation does not match/i)
    expect(alert).not.toHaveTextContent(/account already exists/i)
    expect(
      screen.queryByRole('link', { name: /sign in instead/i }),
    ).not.toBeInTheDocument()
  })

  it('surfaces the IP rate limit rather than a generic failure', async () => {
    // The API rate-limits registration by IP and reports it as a 422 on `email`
    // — the same field a duplicate email uses, so only the text tells them apart.
    fetchMock.mockImplementation(
      routes(() =>
        json(
          {
            message: 'Too many registration attempts.',
            errors: {
              email: [
                'Too many registration attempts. Please try again in 47 seconds.',
              ],
            },
          },
          422,
        ),
      ),
    )

    renderAt('/register')
    await screen.findByRole('heading', { name: /create account/i })

    await fillForm()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /too many registration attempts.*47 seconds/i,
    )
    expect(
      screen.queryByRole('link', { name: /sign in instead/i }),
    ).not.toBeInTheDocument()
  })

  it('links to the sign-in screen', async () => {
    fetchMock.mockImplementation(routes(() => json(NEW_USER, 201)))

    renderAt('/register')
    await screen.findByRole('heading', { name: /create account/i })

    await userEvent.click(screen.getByRole('link', { name: /^sign in$/i }))

    expect(
      await screen.findByRole('heading', { name: /sign in/i }),
    ).toBeInTheDocument()
  })
})
