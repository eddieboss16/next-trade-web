import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { ApiError, validationErrors } from '../lib/api'

/**
 * What went wrong, as a discriminated outcome rather than one "something went
 * wrong" string. `duplicate-email` is the case the spec singles out: it is not a
 * failure the user should retry, it means they already have an account, so it
 * gets its own copy AND a route out (the sign-in link) instead of a red box
 * telling them to try again.
 */
type RegisterFailure =
  | { kind: 'duplicate-email'; message: string }
  | { kind: 'validation'; message: string }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'session-expired'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'unexpected'; message: string }

/**
 * `422` carries three different stories here — a duplicate email, the IP rate
 * limit, and ordinary field validation — separated only by the response body,
 * the same discipline the order ticket applies to its overloaded statuses.
 *
 * The two special cases are told apart by a distinctive SUBSTRING of the
 * message, never the exact string: if Laravel rewords them, this degrades to
 * the generic validation message rather than silently mislabelling one case as
 * the other.
 */
function describeRegisterFailure(error: unknown): RegisterFailure {
  if (!(error instanceof ApiError)) {
    return {
      kind: 'unreachable',
      message: 'Could not reach the trading API. Is next-trade-api running?',
    }
  }

  if (error.status === 422) {
    const errors = validationErrors(error)
    const emailErrors = errors.email ?? []

    if (emailErrors.some((message) => /already been taken/i.test(message))) {
      return {
        kind: 'duplicate-email',
        message: 'An account already exists with that email address.',
      }
    }

    // The API rate-limits registration by IP and reports it as a 422 on `email`.
    if (emailErrors.some((message) => /too many/i.test(message))) {
      return { kind: 'rate-limited', message: emailErrors[0] }
    }

    const first = Object.values(errors).flat()[0]
    return {
      kind: 'validation',
      message: first ?? error.message ?? 'Check the form and try again.',
    }
  }

  switch (error.status) {
    case 419:
      return {
        kind: 'session-expired',
        message:
          'Your session expired before the request completed. Try again.',
      }
    case 429:
      return {
        kind: 'rate-limited',
        message: 'Too many sign-up attempts. Wait a moment and try again.',
      }
    default:
      return { kind: 'unexpected', message: error.message }
  }
}

export function RegisterPage() {
  const { status, register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [failure, setFailure] = useState<RegisterFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Same end state as a successful login — the API established the session, so
  // the new user goes straight to the dashboard.
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFailure(null)
    setSubmitting(true)
    try {
      await register({
        name,
        email,
        password,
        password_confirmation: passwordConfirmation,
      })
    } catch (caught) {
      setFailure(describeRegisterFailure(caught))
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
        <h1 className="text-xl font-semibold text-slate-100">Create account</h1>
        <p className="mt-1 text-sm text-slate-400">next-trade</p>

        <label
          htmlFor="name"
          className="mt-6 block text-sm font-medium text-slate-300"
        >
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-slate-100 outline-none focus:border-slate-500"
        />

        <label
          htmlFor="email"
          className="mt-4 block text-sm font-medium text-slate-300"
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
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-slate-100 outline-none focus:border-slate-500"
        />

        <label
          htmlFor="password_confirmation"
          className="mt-4 block text-sm font-medium text-slate-300"
        >
          Confirm password
        </label>
        <input
          id="password_confirmation"
          name="password_confirmation"
          type="password"
          autoComplete="new-password"
          required
          value={passwordConfirmation}
          onChange={(event) => setPasswordConfirmation(event.target.value)}
          className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-slate-100 outline-none focus:border-slate-500"
        />

        {failure && (
          <p
            role="alert"
            className="mt-4 rounded border border-down/40 bg-down/10 px-3 py-2 text-sm text-red-300"
          >
            {failure.message}
            {failure.kind === 'duplicate-email' && (
              <>
                {' '}
                <Link to="/login" className="font-medium underline">
                  Sign in instead
                </Link>
                .
              </>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded bg-slate-100 px-3 py-2 font-medium text-slate-900 disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="mt-4 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="text-slate-200 underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  )
}
