import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useInstruments } from '../instruments/context'
import { AccountSummary } from '../components/AccountSummary'
import { OpenOrders } from '../components/OpenOrders'

export function AccountPage() {
  const { user, logout } = useAuth()
  const { instruments } = useInstruments()
  const [loggingOut, setLoggingOut] = useState(false)

  // Read straight off the authenticated user: the API appends `account_id` to
  // the user payload. Null is a real state (no account linked), not a lookup
  // that failed — so it gets its own message rather than an empty money panel.
  const accountId = user?.account_id ?? null

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-edge px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-slate-100">next-trade</span>
          <Link to="/dashboard" className="text-sm text-slate-400 hover:text-slate-200">
            Trading
          </Link>
          <span className="text-sm text-slate-200">Account</span>
        </div>

        <div className="flex items-center gap-4 text-sm text-slate-400">
          <span>{user?.email}</span>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded border border-edge px-3 py-1 text-slate-200 hover:border-slate-500 disabled:opacity-50"
          >
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        {accountId === null ? (
          <div
            role="status"
            className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
          >
            <p className="font-medium">No trading account linked</p>
            <p className="mt-1 text-slate-300">
              This user has no trading account, so there is no balance, equity or
              margin to show. Orders cannot be placed until one exists.
            </p>
          </div>
        ) : (
          <AccountSummary accountId={accountId} />
        )}

        <OpenOrders instruments={instruments} refreshToken={0} />
      </main>
    </div>
  )
}
