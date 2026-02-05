/**
 * Dashboard State - Operation tree model
 */

export type OperationStatus = 'active' | 'completed' | 'warning' | 'failed';

/**
 * Transient provider status (rate limit backoff or failover notification).
 * Shared by import stream sub-lines and processing metadata line.
 */
export type TransientMessage =
  | { expiresAt: number; type: 'backoff' }
  | { expiresAt: number; text: string; type: 'failover' };

/**
 * Account information
 */
export interface AccountInfo {
  id: number;
  isResuming: boolean;
}

/**
 * Provider readiness status
 */
export interface ProviderReadiness {
  count: number;
  durationMs: number;
}

/**
 * Stream state within import operation
 */
export interface StreamState {
  name: string;
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;

  // Current batch being fetched (for active streams)
  currentBatch?: number | undefined;

  // Cumulative count of items imported
  imported: number;

  // Active provider info (for active streams)
  activeProvider?: string | undefined;
  currentRate?: number | undefined; // req/s
  maxRate?: number | undefined;

  // Transient message (rate limit or failover)
  transientMessage?: TransientMessage | undefined;

  // Failure info (for warning/failed status)
  errorMessage?: string | undefined;
}

/**
 * Import operation state
 */
export interface ImportOperation {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  streams: Map<string, StreamState>;
}

/**
 * Token metadata tracking during processing (provider/rate mirrors import stream pattern)
 */
export interface ProcessingMetadata {
  cached: number;
  fetched: number;
  activeProvider?: string | undefined;
  currentRate?: number | undefined;
  maxRate?: number | undefined;
  transientMessage?: TransientMessage | undefined;
}

/**
 * Processing operation state
 */
export interface ProcessingOperation {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;

  // Total raw transactions to process (from process.started)
  totalRaw: number;
  // Accumulated processed count (from process.batch.completed batchSize)
  processed: number;
  // Final deduplicated transaction count (from process.completed)
  totalProcessed?: number | undefined;

  // Token metadata enrichment — undefined for CSV imports (no metadata events fire)
  metadata?: ProcessingMetadata | undefined;
  // Scam detection summary — undefined until first scam found
  scams?: { exampleSymbols: string[]; total: number } | undefined;
}

/**
 * API call statistics per provider
 */
export interface ProviderApiStats {
  total: number;
  retries: number;
  rateLimited: number;
  failed: number;

  // Response breakdown (for final view)
  responsesByStatus: Map<number, number>; // status code -> count
}

/**
 * Overall API call tracking
 */
export interface ApiCallStats {
  total: number;
  byProvider: Map<string, ProviderApiStats>;
}

/**
 * Warning message
 */
export interface Warning {
  message: string;
}

/**
 * Complete Dashboard State
 */
export interface DashboardState {
  // Account info
  account?: AccountInfo | undefined;

  // Provider readiness
  providerReadiness?: ProviderReadiness | undefined;

  // Blockchain being imported (set from provider events; undefined for exchange imports)
  blockchain?: string | undefined;

  // Current active provider (global, applies to all streams)
  currentProvider?: string | undefined;

  // Import operation
  import?: ImportOperation | undefined;

  // Processing operation
  processing?: ProcessingOperation | undefined;

  // API call statistics
  apiCalls: ApiCallStats;

  // Completion status
  isComplete: boolean;
  totalDurationMs?: number | undefined;

  // Warnings
  warnings: Warning[];
}

/**
 * Create initial dashboard state
 */
export function createDashboardState(): DashboardState {
  return {
    account: undefined,
    providerReadiness: undefined,
    import: undefined,
    processing: undefined,
    apiCalls: {
      total: 0,
      byProvider: new Map(),
    },
    isComplete: false,
    totalDurationMs: undefined,
    warnings: [],
  };
}

/**
 * Get or create provider stats entry
 */
export function getOrCreateProviderStats(state: DashboardState, provider: string): ProviderApiStats {
  let stats = state.apiCalls.byProvider.get(provider);
  if (!stats) {
    stats = {
      total: 0,
      retries: 0,
      rateLimited: 0,
      failed: 0,
      responsesByStatus: new Map(),
    };
    state.apiCalls.byProvider.set(provider, stats);
  }
  return stats;
}
