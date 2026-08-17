import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL, ApiError, login, logout, register } from './api'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.trim().split('=')[0]
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  clearCookies()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearCookies()
})

describe('API base URL', () => {
  it('uses localhost, not 127.0.0.1 — cookies are host-scoped', () => {
    expect(new URL(API_BASE_URL).hostname).toBe('localhost')
    expect(API_BASE_URL).not.toContain('127.0.0.1')
  })
})

describe('login (spec §1 required test: CSRF priming)', () => {
  it('primes the CSRF cookie before POSTing credentials', async () => {
    const requested: string[] = []

    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      requested.push(url)

      if (url.endsWith('/sanctum/csrf-cookie')) {
        // Laravel sets this cookie on the response; jsdom won't, so do it here.
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/api/login')) {
        return json({ id: 1, name: 'Trader', email: 'trader@example.com' }, 200)
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const user = await login({
      email: 'trader@example.com',
      password: 'secret',
    })

    expect(user.email).toBe('trader@example.com')
    expect(requested).toEqual([
      `${API_BASE_URL}/sanctum/csrf-cookie`,
      `${API_BASE_URL}/api/login`,
    ])

    const csrfIndex = requested.indexOf(`${API_BASE_URL}/sanctum/csrf-cookie`)
    const loginIndex = requested.indexOf(`${API_BASE_URL}/api/login`)
    expect(csrfIndex).toBeLessThan(loginIndex)
  })

  it('sends the primed token back as X-XSRF-TOKEN and includes credentials', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      return json({ id: 1, name: 'Trader', email: 'trader@example.com' }, 200)
    })

    await login({ email: 'trader@example.com', password: 'secret' })

    const [csrfCall, loginCall] = fetchMock.mock.calls
    expect(csrfCall[1]?.credentials).toBe('include')

    const loginInit = loginCall[1]
    expect(loginInit?.credentials).toBe('include')
    const headers = new Headers(loginInit?.headers)
    expect(headers.get('X-XSRF-TOKEN')).toBe('csrf-token-value')
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('does not swallow a rejected login — surfaces the status for the UI', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      return json(
        {
          message: 'These credentials do not match our records.',
          errors: { email: ['These credentials do not match our records.'] },
        },
        422,
      )
    })

    const error = await login({ email: 'a@b.com', password: 'wrong' }).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
  })

  it('never writes auth state to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      return json({ id: 1, name: 'Trader', email: 'trader@example.com' }, 200)
    })

    await login({ email: 'trader@example.com', password: 'secret' })

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})

describe('register', () => {
  const DETAILS = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'password123',
    password_confirmation: 'password123',
  }

  it('primes the CSRF cookie before POSTing the sign-up, same as login', async () => {
    const requested: string[] = []

    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      requested.push(url)

      if (url.endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      // The API answers 201 (not login's 200) with the user, account_id included.
      return json({ ...DETAILS, id: 7, account_id: 'acct-new' }, 201)
    })

    const user = await register(DETAILS)

    expect(user.email).toBe('ada@example.com')
    expect(user.account_id).toBe('acct-new')
    expect(requested).toEqual([
      `${API_BASE_URL}/sanctum/csrf-cookie`,
      `${API_BASE_URL}/api/register`,
    ])
  })

  it('sends the confirmation field under Laravel’s snake_case name', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      return json({ ...DETAILS, id: 7, account_id: 'acct-new' }, 201)
    })

    await register(DETAILS)

    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(body.password_confirmation).toBe('password123')
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('X-XSRF-TOKEN')).toBe(
      'csrf-token-value',
    )
  })

  it('surfaces a duplicate email as a 422 for the UI to discriminate on', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      return json(
        {
          message: 'The email has already been taken.',
          errors: { email: ['The email has already been taken.'] },
        },
        422,
      )
    })

    const error = await register(DETAILS).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
  })

  it('never writes auth state to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      return json({ ...DETAILS, id: 7, account_id: 'acct-new' }, 201)
    })

    await register(DETAILS)

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})

describe('logout', () => {
  it('POSTs with the CSRF header, priming the cookie first if absent', async () => {
    const requested: string[] = []
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith('/sanctum/csrf-cookie')) {
        document.cookie = 'XSRF-TOKEN=csrf-token-value'
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 204 })
    })

    await logout()

    expect(requested).toEqual([
      `${API_BASE_URL}/sanctum/csrf-cookie`,
      `${API_BASE_URL}/api/logout`,
    ])
    const logoutInit = fetchMock.mock.calls[1][1]
    expect(logoutInit?.method).toBe('POST')
    expect(new Headers(logoutInit?.headers).get('X-XSRF-TOKEN')).toBe(
      'csrf-token-value',
    )
  })

  it('skips re-priming when the CSRF cookie is already set', async () => {
    document.cookie = 'XSRF-TOKEN=already-primed'
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await logout()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `${API_BASE_URL}/api/logout`,
    )
  })
})
