import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchInstruments, type Instrument } from '../lib/instruments'
import { InstrumentsContext, type InstrumentsStatus } from './context'

/**
 * Loads `GET /api/instruments` once for the app. The endpoint is public, so
 * this does not wait on authentication and runs in parallel with the session
 * check.
 */
export function InstrumentsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<InstrumentsStatus>('loading')
  const [instruments, setInstruments] = useState<Instrument[]>([])
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => {
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    fetchInstruments()
      .then((loaded) => {
        if (cancelled) return
        setInstruments(loaded)
        setStatus(loaded.length > 0 ? 'ready' : 'error')
      })
      .catch(() => {
        if (cancelled) return
        setInstruments([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const value = useMemo(
    () => ({ status, instruments, reload }),
    [status, instruments, reload],
  )

  return <InstrumentsContext value={value}>{children}</InstrumentsContext>
}
