/**
 * Dashboard State - Operation tree model
 */

import type { OperationStatus, ProviderApiStats, ApiCallStats } from '../shared/index.js';
import { createProviderStats } from '../shared/index.js';

export type { OperationStatus, ProviderApiStats, ApiCallStats };

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
  /**
   * True if this is the first import for this account (no prior cursor data).
   * False means the account has prior data (incremental import).
   */
  isNewAccount: boolean;
  /**
   * True if this is an xpub parent account
   */
  isXpubParent?: boolean | undefined;
  /**
   * Number of derived child addresses (for xpub parents)
   */
  childAccountCount?: number | undefined;
  /**
   * Transaction counts by stream type (only present for existing accounts)
   */
  transactionCounts?: Map<string, number> | undefined;
}

/**
 * Provider readiness status
 */
export interface ProviderReadiness {
  count: number;
  durationMs: number;
}

/**
 * Xpub derivation operation state
 */
export interface DerivationOperation {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  isRederivation: boolean;
  gapLimit: number;
  previousGap?: number | undefined;
  derivedCount?: number | undefined;
  newCount?: number | undefined; // For re-derivation only
}

/**
 * Xpub import wrapper state (aggregates child imports)
 */
export interface XpubImportWrapper {
  parentAccountId: number;
  childAccountCount: number;
  blockchain: string;

  // Aggregated streams across all children
  aggregatedStreams: Map<string, StreamState>;
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
 * Warning message
 */
export interface Warning {
  message: string;
}

/**
 * Complete Dashboard State
 */
export interface IngestionMonitorState {
  // Account info
  account?: AccountInfo | undefined;

  // Provider readiness
  providerReadiness?: ProviderReadiness | undefined;

  // Blockchain being imported (set from provider events; undefined for exchange imports)
  blockchain?: string | undefined;

  // Current active provider (global, applies to all streams)
  currentProvider?: string | undefined;

  // Derivation operation (xpub only)
  derivation?: DerivationOperation | undefined;

  // Xpub import wrapper (when importing xpub)
  xpubImport?: XpubImportWrapper | undefined;

  // Import operation
  import?: ImportOperation | undefined;

  // Processing operation
  processing?: ProcessingOperation | undefined;

  // API call statistics
  apiCalls: ApiCallStats;

  // Completion status
  isComplete: boolean;
  aborted?: boolean | undefined;
  errorMessage?: string | undefined;
  totalDurationMs?: number | undefined;

  // Warnings
  warnings: Warning[];
}

/**
 * Create initial dashboard state
 */
export function createIngestionMonitorState(): IngestionMonitorState {
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
    errorMessage: undefined,
    totalDurationMs: undefined,
    warnings: [],
  };
}

/**
 * Callback bridge for lifecycle signals from controller to React component.
 *
 * **Why this exists:**
 * When the user presses Ctrl-C (SIGINT), the controller must:
 * 1. Dispatch abort state to React
 * 2. Force synchronous render (flushRender)
 * 3. Call process.exit(130)
 *
 * Normal event emission via EventBus uses queueMicrotask, which won't flush
 * before process.exit terminates the process. This would leave the UI showing
 * stale state instead of the abort message.
 *
 * **How it works:**
 * - Controller calls `lifecycle.onAbort?.()` synchronously
 * - Component's useLayoutEffect sets `onAbort = () => dispatch({ type: 'abort' })`
 * - Controller calls `flushRender()` to force synchronous React commit
 * - UI paints abort state
 * - process.exit(130) terminates cleanly
 *
 * **Pattern:**
 * ```tsx
 * // In component:
 * useLayoutEffect(() => {
 *   lifecycle.onAbort = () => dispatch({ type: 'abort' })
 *   lifecycle.onFail = (msg) => dispatch({ type: 'fail', errorMessage: msg })
 *   return () => {
 *     lifecycle.onAbort = undefined
 *     lifecycle.onFail = undefined
 *   }
 * }, [lifecycle])
 *
 * // In controller:
 * abort(): void {
 *   this.lifecycle.onAbort?.()
 *   this.flushRender()  // Force synchronous render
 *   // process.exit(130) happens next in signal handler
 * }
 * ```
 *
 * @see {@link https://react.dev/reference/react-dom/flushSync} - React's flushSync (Ink's flushRender is similar)
 */
export interface LifecycleBridge {
  onAbort?: (() => void) | undefined;
  onFail?: ((errorMessage: string) => void) | undefined;
}

/**
 * Get or create provider stats entry
 */
export function getOrCreateProviderStats(state: IngestionMonitorState, provider: string): ProviderApiStats {
  let stats = state.apiCalls.byProvider.get(provider);
  if (!stats) {
    stats = createProviderStats();
    state.apiCalls.byProvider.set(provider, stats);
  }
  return stats;
}
