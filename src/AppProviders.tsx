import type { ReactNode } from 'react'
import { AuthProvider } from './auth/AuthProvider'
import { InstrumentsProvider } from './instruments/InstrumentsProvider'

/**
 * The app's context stack, in one place so `main.tsx` and the tests mount the
 * same thing. Instruments are public reference data and load in parallel with
 * the session check — neither provider depends on the other.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <InstrumentsProvider>
      <AuthProvider>{children}</AuthProvider>
    </InstrumentsProvider>
  )
}
