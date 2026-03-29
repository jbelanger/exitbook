import type { OperationStatus, ProviderApiStats, ApiCallStats } from '../../../ui/shared/index.js';
import { createProviderStats } from '../../../ui/shared/index.js';

export type { OperationStatus, ApiCallStats };

/**
 * Transient provider status (rate limit backoff or failover notification).
 * Shared by import stream sub-lines and processing metadata line.
 */
export type TransientMessage =
  | { expiresAt: number; type: 'backoff' }
  | { expiresAt: number; text: string; type: 'failover' };

export interface AccountInfo {
  id: number;
  isNewAccount: boolean;
  isXpubParent?: boolean | undefined;
  childAccountCount?: number | undefined;
  transactionCounts?: Map<string, number> | undefined;
}

export interface ProviderReadiness {
  count: number;
  durationMs: number;
}

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

export interface XpubImportWrapper {
  parentAccountId: number;
  childAccountCount: number;
  blockchain: string;
  aggregatedStreams: Map<string, StreamState>;
}

export interface StreamState {
  name: string;
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  currentBatch?: number | undefined;
  imported: number;
  activeProvider?: string | undefined;
  currentRate?: number | undefined;
  maxRate?: number | undefined;
  transientMessage?: TransientMessage | undefined;
  errorMessage?: string | undefined;
}

export interface ImportOperation {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  streams: Map<string, StreamState>;
}

export interface ProcessingMetadata {
  cached: number;
  fetched: number;
  activeProvider?: string | undefined;
  currentRate?: number | undefined;
  maxRate?: number | undefined;
  transientMessage?: TransientMessage | undefined;
}

export interface ClearingOperation {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  transactions: number;
}

export interface ProcessingOperation {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  totalRaw: number;
  processed: number;
  totalProcessed?: number | undefined;
  metadata?: ProcessingMetadata | undefined;
  scams?: { exampleSymbols: string[]; total: number } | undefined;
}

export interface Warning {
  message: string;
}

export interface IngestionMonitorState {
  account?: AccountInfo | undefined;
  providerReadiness?: ProviderReadiness | undefined;
  blockchain?: string | undefined;
  currentProvider?: string | undefined;
  derivation?: DerivationOperation | undefined;
  xpubImport?: XpubImportWrapper | undefined;
  import?: ImportOperation | undefined;
  clearing?: ClearingOperation | undefined;
  processing?: ProcessingOperation | undefined;
  apiCalls: ApiCallStats;
  isComplete: boolean;
  aborted?: boolean | undefined;
  errorMessage?: string | undefined;
  totalDurationMs?: number | undefined;
  warnings: Warning[];
}

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
