import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from '../lib/api'
import type { Credentials, RegisterDetails, User } from '../lib/api'
import { AuthContext, type AuthStatus } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<User | null>(null)

  // Resolve the session once on mount so a page refresh on a protected route
  // doesn't bounce an already-logged-in user to the login screen.
  useEffect(() => {
    let cancelled = false

    api
      .fetchCurrentUser()
      .then((currentUser) => {
        if (cancelled) return
        setUser(currentUser)
        setStatus(currentUser ? 'authenticated' : 'unauthenticated')
      })
      .catch(() => {
        // API unreachable — treat as logged out rather than hanging on `checking`.
        if (cancelled) return
        setUser(null)
        setStatus('unauthenticated')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (credentials: Credentials) => {
    const loggedIn = await api.login(credentials)
    setUser(loggedIn)
    setStatus('authenticated')
    return loggedIn
  }, [])

  // Registration ends authenticated: the API establishes the session itself, so
  // there is no follow-up login round-trip to make.
  const register = useCallback(async (details: RegisterDetails) => {
    const registered = await api.register(details)
    setUser(registered)
    setStatus('authenticated')
    return registered
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      // Whatever the server said, this browser is done with the session.
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  const value = useMemo(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
