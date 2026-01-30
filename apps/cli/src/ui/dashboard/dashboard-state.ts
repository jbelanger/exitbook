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
  // Provider event cooldowns (prevent spam in activity log)
  // LRU-style: entries cleaned up when checking, max 50 unique event keys
  providerEventCooldowns: Map<string, number>;

  // Per-stream import tracking (for "no new records" detection)
  streamImportCounts: Map<string, number>;

  // Completion flag
  isComplete: boolean;

  // UI state
  activityExpanded: boolean;
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
    providerEventCooldowns: new Map(),
    streamImportCounts: new Map(),
    isComplete: false,
    activityExpanded: false,
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
      // Reset per-stream counts for new import
      state.streamImportCounts.clear();
      break;

    case 'import.batch': {
      state.imported = event.totalImported;

      // Track per-stream import counts
      const currentStreamCount = state.streamImportCounts.get(event.streamType) ?? 0;
      state.streamImportCounts.set(event.streamType, currentStreamCount + event.batchInserted);

      if (event.isComplete) {
        // Stream completed - check if any new records were imported for this stream
        const streamTotal = state.streamImportCounts.get(event.streamType) ?? 0;
        if (streamTotal === 0) {
          addToEventLog(state, '✓', `${event.streamType}: No new records found`);
        }
      }
      break;
    }

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
      state.accountId = event.accountIds.length === 1 ? event.accountIds[0] : undefined;
      break;

    case 'process.batch':
      state.processed = event.totalProcessed;
      break;

    case 'process.completed':
      state.processed = event.totalProcessed;
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

    case 'scam.batch.summary': {
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
      // Show event if scams were detected
      if (event.scamsFound > 0) {
        const examples = event.exampleSymbols.slice(0, 2).join(', ');
        addToEventLog(state, '🚫', `Filtered ${event.scamsFound} scam${event.scamsFound > 1 ? 's' : ''} (${examples})`);
      }
      break;
    }

    case 'provider.resume':
      addToEventLog(state, '↻', formatProviderResumeMessage(event.streamType, event.provider));
      break;

    case 'provider.failover':
      addToEventLog(state, '⇄', `Switched to ${event.to}`);
      break;

    case 'provider.rate_limited': {
      const currentCount = state.providerThrottles.get(event.provider) ?? 0;
      state.providerThrottles.set(event.provider, currentCount + 1);
      if (shouldLogProviderEvent(state, `rate_limited:${event.provider}`, 30000)) {
        addToEventLog(state, '⚠', `${event.provider}: Rate limited`);
      }
      break;
    }

    case 'provider.circuit_open':
      addToEventLog(state, '🔴', `${event.provider}: Circuit breaker opened`);
      break;

    case 'import.session.resumed':
      addToEventLog(state, '↻', `Resumed from previous session`);
      break;

    case 'process.batch.completed':
      // Intentionally quiet: batch-level progress is too noisy for activity log
      break;
    case 'provider.selection':
      // Intentionally quiet: provider selection is shown in other dashboard sections
      break;

    // Silently handled events (no state updates needed)
    case 'import.session.created':
    case 'process.batch.started':
    case 'process.group.processing':
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
    state.events.splice(0, state.events.length - 5);
  }
}

function formatProviderResumeMessage(streamType: string | undefined, provider: string): string {
  const normalized = normalizeStreamType(streamType);
  return normalized ? `Resumed ${normalized} with ${provider}` : `Resumed with ${provider}`;
}

function normalizeStreamType(streamType: string | undefined): string | undefined {
  if (!streamType) return undefined;
  const trimmed = streamType.trim();
  return trimmed || undefined;
}

const MAX_COOLDOWN_ENTRIES = 50;

function shouldLogProviderEvent(state: DashboardState, key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const lastAt = state.providerEventCooldowns.get(key);
  if (lastAt !== undefined && now - lastAt < cooldownMs) {
    return false;
  }

  // LRU-style cleanup: remove oldest entries when map grows too large
  if (state.providerEventCooldowns.size >= MAX_COOLDOWN_ENTRIES) {
    // Remove entries older than 5 minutes
    const cutoffTime = now - 300000;
    for (const [eventKey, timestamp] of state.providerEventCooldowns.entries()) {
      if (timestamp < cutoffTime) {
        state.providerEventCooldowns.delete(eventKey);
      }
    }

    // If still too large, remove oldest entries
    if (state.providerEventCooldowns.size >= MAX_COOLDOWN_ENTRIES) {
      const entries = Array.from(state.providerEventCooldowns.entries());
      entries.sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, Math.floor(MAX_COOLDOWN_ENTRIES / 2));
      for (const [eventKey] of toRemove) {
        state.providerEventCooldowns.delete(eventKey);
      }
    }
  }

  state.providerEventCooldowns.set(key, now);
  return true;
}
