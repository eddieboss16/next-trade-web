import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context'

/**
 * Route guard. Three outcomes, none of which is a blank page:
 *  - session unknown  → a visible "checking session" state
 *  - no session       → redirect to /login, remembering where they were headed
 *  - session          → the protected page
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'checking') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-full items-center justify-center text-sm text-slate-400"
      >
        Checking your session…
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
