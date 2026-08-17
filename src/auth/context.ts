import { createContext, useContext } from 'react'
import type { Credentials, User } from '../lib/api'

/**
 * `checking` is a real state, not a detail: on a full page load we don't know
 * whether the session cookie is valid until `GET /api/user` answers. The route
 * guard must not redirect (or render a protected page) while it is unknown.
 */
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  status: AuthStatus
  user: User | null
  login: (credentials: Credentials) => Promise<User>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside an <AuthProvider>.')
  }
  return value
}
