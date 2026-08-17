/**
 * Tunables, in one place with env overrides — the frontend counterpart to
 * `next-trade-api`'s `config/trading.php`.
 *
 * Same standard as that file: a default is a deliberate, documented decision
 * with a stated rationale, overridable via env. Do NOT silently hardcode one of
 * these numbers at a call site.
 *
 * Nothing here is a market rule. Leverage, margin levels and order validation
 * belong to the backends and are not mirrored, re-derived, or second-guessed
 * on this side. These are presentation and buffering choices only.
 */

function readInt(
  raw: string | undefined,
  fallback: number,
  name: string,
  { min = 0 }: { min?: number } = {},
): number {
  if (raw === undefined || raw === '') return fallback

  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) {
    console.error(
      `[config] ${name}="${raw}" is not an integer >= ${min}; using ${fallback}.`,
    )
    return fallback
  }
  return value
}

export const config = {
  /*
   * Whitespace slots drawn across a skipped-candle gap.
   *
   * The engine never synthesizes candles for empty buckets, so the frontend
   * marks the gap with whitespace instead (see chartData.ts). A weekend on a
   * 1-minute chart is ~2,880 empty buckets; drawing every one leaves the real
   * candles an unreadable sliver, so the run is capped. The gap is meant to be
   * VISIBLE, not to scale. Raise it for gaps drawn closer to proportional,
   * lower it for a more compact chart.
   */
  maxGapSlots: readInt(
    import.meta.env.VITE_MAX_GAP_SLOTS,
    10,
    'VITE_MAX_GAP_SLOTS',
    { min: 1 },
  ),

  /*
   * Closed candles retained client-side.
   *
   * A display buffer, deliberately larger than the engine's own per-instrument
   * `historyLimit` (default 100 in candleService.ts) so a reconnect's
   * candle_history frame is never truncated by our own cap.
   */
  closedCandleLimit: readInt(
    import.meta.env.VITE_CANDLE_HISTORY_LIMIT,
    500,
    'VITE_CANDLE_HISTORY_LIMIT',
    { min: 1 },
  ),

  /** Trade prints retained in memory. */
  tradeBufferSize: readInt(
    import.meta.env.VITE_TRADE_BUFFER_SIZE,
    50,
    'VITE_TRADE_BUFFER_SIZE',
    { min: 1 },
  ),

  /** Trade prints shown in the tape. */
  visibleTrades: readInt(
    import.meta.env.VITE_VISIBLE_TRADES,
    12,
    'VITE_VISIBLE_TRADES',
    { min: 1 },
  ),

  /** Price levels shown per side of the order book. */
  visibleDepthLevels: readInt(
    import.meta.env.VITE_DEPTH_LEVELS,
    8,
    'VITE_DEPTH_LEVELS',
    { min: 1 },
  ),

  /*
   * Decimal places for account money fields.
   *
   * The API's `AccountMetrics` states money is "integers in the account's
   * smallest money unit (cents)", i.e. scale 2. That is an assumption about the
   * account's currency, so it is stated here rather than buried as a `/ 100`.
   */
  moneyScale: readInt(import.meta.env.VITE_MONEY_SCALE, 2, 'VITE_MONEY_SCALE'),

  /*
   * How often the account view re-reads balance/equity/margin.
   *
   * These are computed live per request from ledger_entries + instrument_prices
   * and are never cached server-side, so "live" here means polling. 5s keeps it
   * current without hammering an endpoint that does real work per call.
   */
  accountPollMs: readInt(
    import.meta.env.VITE_ACCOUNT_POLL_MS,
    5000,
    'VITE_ACCOUNT_POLL_MS',
    { min: 500 },
  ),
} as const
