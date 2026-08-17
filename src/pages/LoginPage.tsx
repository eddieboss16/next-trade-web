import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { ApiError, validationErrors } from '../lib/api'

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Could not reach the trading API. Is next-trade-api running?'
  }
  switch (error.status) {
    case 401:
    case 422: {
      const fields = Object.values(validationErrors(error)).flat()
      return fields[0] ?? error.message ?? 'Those credentials were not accepted.'
    }
    case 419:
      return 'Your session expired before the request completed. Try again.'
    case 429:
      return 'Too many login attempts. Wait a moment and try again.'
    default:
      return error.message
  }
}

export function LoginPage() {
  const { status, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/dashboard'} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login({ email, password })
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-edge bg-surface-raised p-8 shadow-lg"
      >
        <h1 className="text-xl font-semibold text-slate-100">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">next-trade</p>

        <label
          htmlFor="email"
          className="mt-6 block text-sm font-medium text-slate-300"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-slate-100 outline-none focus:border-slate-500"
        />

        <label
          htmlFor="password"
          className="mt-4 block text-sm font-medium text-slate-300"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-slate-100 outline-none focus:border-slate-500"
        />

        {error && (
          <p
            role="alert"
            className="mt-4 rounded border border-down/40 bg-down/10 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded bg-slate-100 px-3 py-2 font-medium text-slate-900 disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-center text-sm text-slate-400">
          New here?{' '}
          <Link to="/register" className="text-slate-200 underline">
            Register
          </Link>
        </p>
      </form>
    </main>
  )
}
