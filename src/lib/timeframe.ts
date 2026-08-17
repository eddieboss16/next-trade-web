/**
 * The single timeframe shipped first, mirroring the engine's `ONE_MINUTE_MS`
 * in `feed/candleAggregator.ts`. Buckets are epoch-aligned, so a 1-minute
 * bucket starts on a UTC minute boundary.
 */
export const ONE_MINUTE_MS = 60_000
