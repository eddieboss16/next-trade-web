import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useInstruments } from '../instruments/context'
import { useInstrumentStream } from '../hooks/useInstrumentStream'
import { visibleCandles } from '../lib/streamState'
import type { Instrument } from '../lib/instruments'
import { CandleChart } from '../components/CandleChart'
import { DepthLadder } from '../components/DepthLadder'
import { TradeTape } from '../components/TradeTape'
import { ConnectionBadge } from '../components/ConnectionBadge'
import { OrderTicket } from '../components/OrderTicket'
import { OpenOrders } from '../components/OpenOrders'

function Header({
  children,
  right,
}: {
  children: React.ReactNode
  right: React.ReactNode
}) {
  return (
    <header className="flex items-center justify-between border-b border-edge px-6 py-3">
      <div className="flex items-center gap-3">{children}</div>
      <div className="flex items-center gap-4 text-sm text-slate-400">{right}</div>
    </header>
  )
}

/** The view proper — only ever rendered with instruments already loaded. */
function TradingView({ instruments }: { instruments: Instrument[] }) {
  const { user, logout } = useAuth()
  const [instrument, setInstrument] = useState(instruments[0])
  const [loggingOut, setLoggingOut] = useState(false)
  const [ordersRefreshToken, setOrdersRefreshToken] = useState(0)
  const { state, status } = useInstrumentStream(instrument.id)

  const candles = visibleCandles(state)

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
      <Header
        right={
          <>
            <Link to="/account" className="hover:text-slate-200">
              Account
            </Link>
            <span>{user?.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded border border-edge px-3 py-1 text-slate-200 hover:border-slate-500 disabled:opacity-50"
            >
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        }
      >
        <span className="font-semibold text-slate-100">next-trade</span>
        <label htmlFor="instrument" className="sr-only">
          Instrument
        </label>
        <select
          id="instrument"
          value={instrument.id}
          onChange={(event) => {
            const next = instruments.find((i) => i.id === event.target.value)
            if (next) setInstrument(next)
          }}
          className="rounded border border-edge bg-surface-raised px-2 py-1 text-sm text-slate-200"
        >
          {instruments.map((option) => (
            <option key={option.id} value={option.id}>
              {option.symbol}
            </option>
          ))}
        </select>
        <ConnectionBadge status={status} />
      </Header>

      <main className="grid flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[1fr_20rem]">
        <section
          aria-label="Price chart"
          className="min-h-96 rounded border border-edge bg-surface-raised p-2"
        >
          {candles.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              Waiting for candle history from the engine…
            </p>
          ) : (
            <CandleChart candles={candles} priceScale={instrument.priceScale} />
          )}
        </section>

        <div className="flex flex-col gap-4">
          <OrderTicket
            instrument={instrument}
            onOrderChanged={() => setOrdersRefreshToken((token) => token + 1)}
          />
          <OpenOrders
            instruments={instruments}
            refreshToken={ordersRefreshToken}
          />
          <DepthLadder
            bids={state.bids}
            asks={state.asks}
            priceScale={instrument.priceScale}
            hasDepth={state.hasDepth}
          />
          <TradeTape trades={state.trades} priceScale={instrument.priceScale} />
        </div>
      </main>
    </div>
  )
}

/**
 * Shell: instrument reference data must be loaded before anything renders a
 * price, because without a scale every figure would be wrong by a power of ten.
 * So this waits, or says why it can't — it never falls back to a guessed scale.
 */
export function TradingPage() {
  const { status, instruments, reload } = useInstruments()

  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-full items-center justify-center text-sm text-slate-400"
      >
        Loading instruments…
      </div>
    )
  }

  if (status === 'error' || instruments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div
          role="alert"
          className="max-w-md rounded border border-down/50 bg-down/10 px-4 py-3 text-sm text-red-300"
        >
          <p className="font-medium">Could not load instruments</p>
          <p className="mt-1 text-slate-300">
            <code>GET /api/instruments</code> is the source of truth for price
            and quantity scales. Without it, prices cannot be rendered correctly,
            so nothing is shown rather than showing wrong numbers.
          </p>
          <button
            type="button"
            onClick={reload}
            className="mt-3 rounded border border-edge px-3 py-1 text-slate-200 hover:border-slate-500"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return <TradingView instruments={instruments} />
}
