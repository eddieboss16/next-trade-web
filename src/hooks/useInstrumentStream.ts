/**
 * The stateful shell around the pure `streamState` reducer: owns one native
 * WebSocket to `/stream/:instrumentId`, reconnects with backoff, and feeds every
 * parsed frame through the reducer.
 *
 * Native `WebSocket`, not socket.io — the engine runs a plain `ws` server.
 */

import { useEffect, useReducer, useRef, useState } from 'react'
import { parseStreamMessage } from '../lib/streamMessages'
import {
  initialStreamState,
  reduceStreamMessage,
  type StreamState,
} from '../lib/streamState'

const DEFAULT_ENGINE_WS_URL = 'ws://localhost:8080'

/** See CLAUDE.md — `localhost`, never `127.0.0.1`. */
export const ENGINE_WS_URL: string =
  import.meta.env.VITE_ENGINE_WS_URL ?? DEFAULT_ENGINE_WS_URL

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'closed'

export interface InstrumentStream {
  state: StreamState
  status: ConnectionStatus
}

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000

function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
}

export function useInstrumentStream(instrumentId: string): InstrumentStream {
  const [state, dispatch] = useReducer(reduceStreamMessage, initialStreamState)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  // Survives reconnects; reset once a connection actually opens.
  const attemptRef = useRef(0)

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (disposed) return

      const url = `${ENGINE_WS_URL}/stream/${encodeURIComponent(instrumentId)}`
      socket = new WebSocket(url)

      socket.onopen = () => {
        if (disposed) return
        attemptRef.current = 0
        setStatus('live')
      }

      socket.onmessage = (event: MessageEvent) => {
        if (disposed || typeof event.data !== 'string') return
        const message = parseStreamMessage(event.data)
        // Unparseable or foreign-instrument frames are dropped, never thrown —
        // one bad frame must not tear down a live chart.
        if (message && message.instrumentId === instrumentId) {
          dispatch(message)
        }
      }

      socket.onclose = () => {
        if (disposed) return
        setStatus('reconnecting')
        const delay = reconnectDelay(attemptRef.current)
        attemptRef.current += 1
        retryTimer = setTimeout(connect, delay)
      }

      socket.onerror = () => {
        // `close` always follows `error`; reconnection is handled there so the
        // backoff isn't advanced twice for one failure.
        socket?.close()
      }
    }

    setStatus('connecting')
    connect()

    return () => {
      disposed = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.onerror = null
        socket.close()
      }
      setStatus('closed')
    }
  }, [instrumentId])

  return { state, status }
}
