import { useCallback, useEffect, useState } from 'react'
import {
  fetchAccount,
  formatMarginLevel,
  formatMoney,
  type Account,
  type AccountOutcome,
} from '../lib/account'
import { config } from '../lib/config'

export interface AccountSummaryProps {
  accountId: string
  /** Bump to force an immediate refetch (e.g. after an order is placed). */
  refreshToken?: number
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded border border-edge px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg tabular-nums text-slate-100">{value}</dd>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Metrics({ account }: { account: Account }) {
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <Metric label="Balance" value={formatMoney(account.balance)} />
      <Metric label="Equity" value={formatMoney(account.equity)} />
      <Metric label="Used margin" value={formatMoney(account.used_margin)} />
      <Metric label="Free margin" value={formatMoney(account.free_margin)} />
      <Metric
        label="Margin level"
        value={formatMarginLevel(account.margin_level_pct)}
        // Null is not 0% — it means no used margin at all. Saying so keeps the
        // healthiest possible state from reading like the worst one.
        hint={account.margin_level_pct === null ? 'No open positions' : undefined}
      />
    </dl>
  )
}

type Problem = Exclude<AccountOutcome, { kind: 'ok' }>

/** A switch, not a lookup table, so a new outcome is a compile error here. */
function problemCopy(outcome: Problem): { title: string; detail: string } {
  switch (outcome.kind) {
    case 'price_unavailable':
      return {
        title: 'Live figures unavailable — no current price',
        detail:
          'You hold an open position in an instrument with no current price, so equity and margin cannot be marked to market. The backend reports this rather than treating the missing price as zero.',
      }
    case 'forbidden':
      return { title: 'Not your account', detail: outcome.message }
    case 'not_found':
      return { title: 'Account not found', detail: outcome.message }
    case 'unauthenticated':
      return {
        title: 'Session expired',
        detail: `${outcome.message} Sign in again to see your account.`,
      }
    case 'unreachable':
      return { title: 'Could not reach the API', detail: outcome.message }
    case 'unexpected':
      return {
        title: `Unexpected response (${outcome.status})`,
        detail: outcome.message,
      }
  }
}

/** Every non-200 outcome gets its own legible panel — never a crash or a blank. */
function Problem({ outcome }: { outcome: Problem }) {
  const copy = problemCopy(outcome)

  const tone =
    outcome.kind === 'price_unavailable' || outcome.kind === 'unreachable'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
      : 'border-down/50 bg-down/10 text-red-300'

  return (
    <div
      role="status"
      aria-live="polite"
      data-outcome={outcome.kind}
      className={`rounded border px-3 py-2 text-sm ${tone}`}
    >
      <p data-testid="account-problem-title" className="font-medium">
        {copy.title}
      </p>
      <p className="mt-1 text-slate-300">{copy.detail}</p>
    </div>
  )
}

export function AccountSummary({ accountId, refreshToken = 0 }: AccountSummaryProps) {
  const [outcome, setOutcome] = useState<AccountOutcome | null>(null)
  // The last good figures, kept on screen when a later poll degrades to 503 —
  // stale-but-labelled beats a panel that empties itself.
  const [lastGood, setLastGood] = useState<Account | null>(null)

  const load = useCallback(async () => {
    const next = await fetchAccount(accountId)
    setOutcome(next)
    if (next.kind === 'ok') setLastGood(next.account)
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  // Balance/equity/margin are computed live per request and never cached
  // server-side, so staying current means polling.
  useEffect(() => {
    const timer = setInterval(() => void load(), config.accountPollMs)
    return () => clearInterval(timer)
  }, [load])

  return (
    <section
      aria-label="Account"
      className="rounded border border-edge bg-surface-raised"
    >
      <h2 className="border-b border-edge px-3 py-2 text-sm font-medium text-slate-200">
        Account
      </h2>

      <div className="flex flex-col gap-3 p-3">
        {outcome === null ? (
          <p className="text-sm text-slate-500">Loading account…</p>
        ) : outcome.kind === 'ok' ? (
          <Metrics account={outcome.account} />
        ) : (
          <>
            <Problem outcome={outcome} />
            {lastGood && (
              <>
                <p className="text-xs text-slate-500">
                  Showing the last figures received, which may now be out of date.
                </p>
                <Metrics account={lastGood} />
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
