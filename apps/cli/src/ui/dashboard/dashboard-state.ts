import type { ProviderEvent } from '@exitbook/blockchain-providers';
import type { IngestionEvent } from '@exitbook/ingestion';

export type CliEvent = IngestionEvent | ProviderEvent;

/**
 * Event log entry for dashboard display.
 */
export interface EventLogEntry {
  timestamp: number;
  icon: string;
  message: string;
}

/**
 * Dashboard state - pure data, no logic.
 * All counters update in place (no phase switching).
 */
export interface DashboardState {
  // Header info
  accountId?: number | undefined;
  address?: string | undefined;
  sourceName?: string | undefined;

  // Counters (update in place throughout import/process lifecycle)
  imported: number;
  processed: number;
  apiCalls: number;

  // Timing
  startedAt?: number | undefined;
  completedAt?: number | undefined;

  // Event log (last 5 events)
  events: EventLogEntry[];

  // Metadata stats (accumulated from metadata.batch.completed events)
  metadataStats: {
    cacheHits: number;
    cacheMisses: number;
  };

  // Scam detection stats (accumulated from scam.batch.summary events)
  scamStats: {
    examples: string[]; // Last 3 unique examples
    totalFound: number;
  };

  // Provider throttle tracking (accumulated from provider.rate_limited events)
  providerThrottles: Map<string, number>;

  // Completion flag
  isComplete: boolean;
}

/**
 * Create initial dashboard state.
 */
export function createDashboardState(): DashboardState {
  return {
    accountId: undefined,
    address: undefined,
    sourceName: undefined,
    imported: 0,
    processed: 0,
    apiCalls: 0,
    startedAt: undefined,
    completedAt: undefined,
    events: [],
    metadataStats: {
      cacheHits: 0,
      cacheMisses: 0,
    },
    scamStats: {
      totalFound: 0,
      examples: [],
    },
    providerThrottles: new Map(),
    isComplete: false,
  };
}

/**
 * Update dashboard state from event (pure function).
 * Mutates state in place for performance.
 */
export function updateStateFromEvent(state: DashboardState, event: CliEvent): void {
  switch (event.type) {
    case 'import.started':
      state.startedAt = Date.now();
      state.accountId = event.accountId;
      state.sourceName = event.sourceName;
      state.address = event.address;
      break;

    case 'import.batch':
      state.imported = event.totalImported;
      if (event.batchInserted > 0) {
        addToEventLog(state, 'ℹ', `Saved batch of ${event.batchInserted} transactions`);
      }
      break;

    case 'import.warning':
      addToEventLog(state, '⚠', `Warning: ${event.warning}`);
      break;

    case 'import.completed':
      // Import complete, processing will start next
      break;

    case 'import.failed':
      addToEventLog(state, '✗', `Import failed: ${event.error}`);
      break;

    case 'process.started':
      // Processing phase started
      break;

    case 'process.batch':
      state.processed = event.totalProcessed;
      break;

    case 'process.completed':
      state.completedAt = Date.now();
      state.isComplete = true;
      break;

    case 'process.failed':
      addToEventLog(state, '✗', `Processing failed: ${event.error}`);
      state.isComplete = true;
      break;

    case 'process.skipped':
      addToEventLog(state, 'ℹ', `Skipped: ${event.reason}`);
      break;

    case 'metadata.batch.completed':
      state.metadataStats.cacheHits += event.cacheHits;
      state.metadataStats.cacheMisses += event.cacheMisses;
      addToEventLog(state, 'ℹ', `Batch #${event.batchNumber}: ${event.cacheHits} cached, ${event.cacheMisses} fetched`);
      break;

    case 'scam.batch.summary':
      state.scamStats.totalFound += event.scamsFound;
      // Track recent examples (last 3 unique)
      if (event.exampleSymbols.length > 0) {
        for (const symbol of event.exampleSymbols) {
          if (!state.scamStats.examples.includes(symbol)) {
            state.scamStats.examples.push(symbol);
            if (state.scamStats.examples.length > 3) {
              state.scamStats.examples.shift();
            }
          }
        }
      }
      break;

    case 'provider.resume':
      addToEventLog(state, '↻', `Resumed ${event.streamType} with ${event.provider}`);
      break;

    case 'provider.failover':
      addToEventLog(state, '⇄', `Switched to ${event.to}`);
      break;

    case 'provider.rate_limited': {
      const currentCount = state.providerThrottles.get(event.provider) ?? 0;
      state.providerThrottles.set(event.provider, currentCount + 1);
      addToEventLog(state, '⚠', `${event.provider}: Rate limited`);
      break;
    }

    case 'provider.circuit_open':
      addToEventLog(state, '🔴', `${event.provider}: Circuit breaker opened`);
      break;

    // Silently handled events (no state updates needed)
    case 'import.session.created':
    case 'import.session.resumed':
    case 'process.batch.started':
    case 'process.batch.completed':
    case 'process.group.processing':
    case 'provider.selection':
    case 'provider.cursor.adjusted':
    case 'provider.backoff':
    case 'provider.request.started':
    case 'provider.request.succeeded':
    case 'provider.request.failed':
      break;

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Add event to the event log (keeps last 5 events).
 */
function addToEventLog(state: DashboardState, icon: string, message: string): void {
  state.events.push({
    timestamp: Date.now(),
    icon,
    message,
  });

  // Keep only last 5 events
  if (state.events.length > 5) {
    state.events = state.events.slice(-5);
  }
}
