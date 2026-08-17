import { createContext, useContext } from 'react'
import type { Instrument } from '../lib/instruments'

/**
 * Reference data is fetched, so "not loaded yet" and "failed to load" are real
 * states. Neither may be papered over: without a scale, every price on screen
 * would be wrong by a power of ten, so the UI waits or says so rather than
 * guessing a default.
 */
export type InstrumentsStatus = 'loading' | 'ready' | 'error'

export interface InstrumentsContextValue {
  status: InstrumentsStatus
  instruments: Instrument[]
  reload: () => void
}

export const InstrumentsContext = createContext<InstrumentsContextValue | null>(
  null,
)

export function useInstruments(): InstrumentsContextValue {
  const value = useContext(InstrumentsContext)
  if (!value) {
    throw new Error('useInstruments must be used inside an <InstrumentsProvider>.')
  }
  return value
}
