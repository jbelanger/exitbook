/**
 * Shared API statistics types
 *
 * Used by both ingestion monitor and prices enrich for tracking API call metrics.
 */

/**
 * API call statistics per provider
 */
export interface ProviderApiStats {
  /** Total calls made to this provider */
  total: number;
  /** Successful calls (2xx except 429) */
  okCount: number;
  /** Number of retries performed */
  retries: number;
  /** Rate limited calls (429) */
  throttledCount: number;
  /** Failed calls (4xx/5xx excluding 429) */
  failed: number;
  /** Current request rate (req/s) in recent window */
  currentRate?: number | undefined;
  /** Number of requests currently in-flight (for active status during long calls) */
  inFlightCount: number;

  /** Response breakdown by HTTP status code (for final view) */
  responsesByStatus: Map<number, number>;

  /** Individual latencies for avg calculation */
  latencies: number[];
  /** Timestamp of first call (0 if no calls yet) */
  startTime: number;
  /** Timestamp of most recent call */
  lastCallTime: number;
}

/**
 * Overall API call tracking across all providers
 */
export interface ApiCallStats {
  /** Total calls across all providers */
  total: number;
  /** Per-provider statistics */
  byProvider: Map<string, ProviderApiStats>;
}

/**
 * Create a new provider stats entry with default values
 */
export function createProviderStats(): ProviderApiStats {
  return {
    total: 0,
    okCount: 0,
    retries: 0,
    throttledCount: 0,
    failed: 0,
    currentRate: undefined,
    inFlightCount: 0,
    responsesByStatus: new Map(),
    latencies: [],
    startTime: 0,
    lastCallTime: 0,
  };
}

/**
 * Get or create provider stats entry in a stats map
 */
export function getOrCreateProviderStats(
  byProvider: Map<string, ProviderApiStats>,
  provider: string
): ProviderApiStats {
  let stats = byProvider.get(provider);
  if (!stats) {
    stats = createProviderStats();
    byProvider.set(provider, stats);
  }
  return stats;
}
