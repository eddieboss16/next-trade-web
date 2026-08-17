import type { ConnectionStatus } from '../hooks/useInstrumentStream'

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
}

const STYLES: Record<ConnectionStatus, string> = {
  connecting: 'border-slate-600 text-slate-400',
  live: 'border-up/50 text-green-400',
  reconnecting: 'border-amber-500/50 text-amber-400',
  closed: 'border-down/50 text-red-400',
}

/**
 * Connection state is market-relevant, not decoration: a stalled socket makes
 * the chart quietly stale, which looks identical to a quiet market.
 */
export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`rounded border px-2 py-0.5 text-xs ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  )
}
