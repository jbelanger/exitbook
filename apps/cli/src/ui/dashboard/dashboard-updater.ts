/**
 * Dashboard State Updater - Pure functions to update state from events
 */

import { performance } from 'node:perf_hooks';

import type { BlockchainProviderManager, ProviderEvent } from '@exitbook/blockchain-providers';
import type { InstrumentationCollector } from '@exitbook/http';
import type { IngestionEvent } from '@exitbook/ingestion';

import type { DashboardState, ImportOperation } from './dashboard-state.js';
import { getOrCreateProviderStats } from './dashboard-state.js';

type CliEvent = IngestionEvent | ProviderEvent;

// Timing constants
const FAILOVER_MESSAGE_DURATION_MS = 3000;
const RATE_CALCULATION_WINDOW_MS = 5000;

/**
 * Update dashboard state from event (mutates state in place for performance).
 */
export function updateStateFromEvent(
  state: DashboardState,
  event: CliEvent,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  switch (event.type) {
    case 'import.started':
      handleImportStarted(state, event);
      break;

    case 'import.batch':
      handleImportBatch(state, event);
      break;

    case 'import.completed':
      handleImportCompleted(state);
      break;

    case 'import.failed':
      handleImportFailed(state, event);
      break;

    case 'import.warning':
      handleImportWarning(state, event);
      break;

    case 'provider.selection':
      handleProviderSelection(state, event, providerManager);
      break;

    case 'provider.resume':
      handleProviderResume(state, event);
      break;

    case 'provider.request.started':
      handleProviderRequestStarted(state, event);
      break;

    case 'provider.request.succeeded':
      handleProviderRequestSucceeded(state, event, instrumentation, providerManager);
      break;

    case 'provider.request.failed':
      handleProviderRequestFailed(state, event, instrumentation, providerManager);
      break;

    case 'provider.rate_limited':
      handleProviderRateLimited(state, event);
      break;

    case 'provider.backoff':
      handleProviderBackoff(state, event);
      break;

    case 'provider.failover':
      handleProviderFailover(state, event);
      break;

    case 'process.started':
      handleProcessStarted(state, event);
      break;

    case 'process.batch.completed':
      handleProcessBatchCompleted(state, event);
      break;

    case 'process.completed':
      handleProcessCompleted(state, event);
      break;

    case 'metadata.batch.completed':
      handleMetadataBatchCompleted(state, event, instrumentation, providerManager);
      break;

    case 'scam.batch.summary':
      handleScamBatchSummary(state, event);
      break;

    // Events with no V3 dashboard representation
    case 'import.session.created':
    case 'import.session.resumed':
    case 'process.batch':
    case 'process.batch.started':
    case 'process.group.processing':
    case 'process.skipped':
    case 'process.failed':
    case 'provider.cursor.adjusted':
    case 'provider.circuit_open':
      break;

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Handle import.started event
 */
function handleImportStarted(state: DashboardState, event: Extract<IngestionEvent, { type: 'import.started' }>): void {
  state.account = {
    id: event.accountId,
    isResuming: event.resuming,
  };

  state.import = {
    status: 'active',
    startedAt: performance.now(),
    streams: new Map(),
  };
}

/**
 * Resolve start time for new stream.
 * Streams are processed sequentially, so a new stream starts when the previous
 * one completes. If this is the first stream, use import start time.
 */
function resolveStreamStartTime(importOp: ImportOperation): number {
  const streams = Array.from(importOp.streams.values());
  const lastStream = streams[streams.length - 1];
  return lastStream?.completedAt || importOp.startedAt;
}

/**
 * Handle import.batch event
 */
function handleImportBatch(state: DashboardState, event: Extract<IngestionEvent, { type: 'import.batch' }>): void {
  if (!state.import) return;

  let stream = state.import.streams.get(event.streamType);

  if (!stream) {
    stream = {
      name: event.streamType,
      status: 'active',
      startedAt: resolveStreamStartTime(state.import),
      imported: 0,
      currentBatch: 0,
      activeProvider: state.currentProvider,
    };
    state.import.streams.set(event.streamType, stream);
  }

  stream.currentBatch = (stream.currentBatch || 0) + 1;
  stream.imported += event.batchInserted;

  if (event.isComplete) {
    // Preserve failed/warning status if already set (e.g., warning arrived before completion)
    if (stream.status !== 'failed' && stream.status !== 'warning') {
      stream.status = 'completed';
    }
    stream.completedAt = performance.now();
    stream.currentBatch = undefined;
  }
}

/**
 * Handle import.completed event
 */
function handleImportCompleted(state: DashboardState): void {
  if (!state.import) return;

  state.import.status = 'completed';
  state.import.completedAt = performance.now();
}

/**
 * Handle import.failed event
 */
function handleImportFailed(state: DashboardState, event: Extract<IngestionEvent, { type: 'import.failed' }>): void {
  if (!state.import) return;

  state.import.status = 'failed';
  state.import.completedAt = performance.now();

  state.isComplete = true;
  state.totalDurationMs = performance.now() - state.import.startedAt;

  state.warnings.push({
    message: event.error,
  });
}

/**
 * Handle import.warning event
 */
function handleImportWarning(state: DashboardState, event: Extract<IngestionEvent, { type: 'import.warning' }>): void {
  state.warnings.push({
    message: event.warning,
  });

  // Mark the associated stream as failed if specified
  if (event.streamType && state.import) {
    const stream = state.import.streams.get(event.streamType);
    if (!stream) {
      // Warning arrived before any batch event for this stream
      state.import.streams.set(event.streamType, {
        name: event.streamType,
        status: 'failed',
        startedAt: resolveStreamStartTime(state.import),
        imported: 0,
        currentBatch: 0,
        activeProvider: state.currentProvider,
        errorMessage: event.warning,
      });
    } else {
      stream.status = 'failed';
      stream.errorMessage = event.warning;
      if (!stream.completedAt) {
        stream.completedAt = performance.now();
      }
    }
  }
}

/**
 * Handle provider.selection event
 */
function handleProviderSelection(
  state: DashboardState,
  event: Extract<ProviderEvent, { type: 'provider.selection' }>,
  providerManager: BlockchainProviderManager
): void {
  state.currentProvider = event.selected;
  state.blockchain = event.blockchain;

  // Set provider readiness on first selection
  if (!state.providerReadiness && state.import) {
    const availableProviders = providerManager.getProviders(event.blockchain);
    state.providerReadiness = {
      count: availableProviders.length,
      durationMs: performance.now() - state.import.startedAt,
    };
  }

  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.status === 'active') {
        stream.activeProvider = event.selected;
      }
    }
  }

  if (state.processing?.metadata) {
    state.processing.metadata.activeProvider = event.selected;
  }
}

/**
 * Handle provider.resume event
 */
function handleProviderResume(state: DashboardState, event: Extract<ProviderEvent, { type: 'provider.resume' }>): void {
  state.currentProvider = event.provider;
  state.blockchain = event.blockchain;

  // Update all active streams to use the resumed provider
  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.status === 'active') {
        stream.activeProvider = event.provider;
      }
    }
  }

  if (state.processing?.metadata) {
    state.processing.metadata.activeProvider = event.provider;
  }
}

/**
 * Handle provider.request.started event
 */
function handleProviderRequestStarted(
  state: DashboardState,
  event: Extract<ProviderEvent, { type: 'provider.request.started' }>
): void {
  // Clear transient message on active import streams
  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.activeProvider === event.provider) {
        stream.transientMessage = undefined;
      }
    }
  }

  // Clear transient on processing metadata
  if (state.processing?.metadata?.activeProvider === event.provider) {
    state.processing.metadata.transientMessage = undefined;
  }
}

/**
 * Handle provider.request.succeeded event
 */
function handleProviderRequestSucceeded(
  state: DashboardState,
  event: Extract<ProviderEvent, { type: 'provider.request.succeeded' }>,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.total++;
  state.apiCalls.total++;

  const count = stats.responsesByStatus.get(event.status) || 0;
  stats.responsesByStatus.set(event.status, count + 1);

  updateStreamRates(state, instrumentation, providerManager);
  updateProcessingRates(state, instrumentation, providerManager);
}

/**
 * Handle provider.request.failed event
 */
function handleProviderRequestFailed(
  state: DashboardState,
  event: Extract<ProviderEvent, { type: 'provider.request.failed' }>,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.total++;
  stats.failed++;
  state.apiCalls.total++;

  if (event.status) {
    const count = stats.responsesByStatus.get(event.status) || 0;
    stats.responsesByStatus.set(event.status, count + 1);
  }

  updateStreamRates(state, instrumentation, providerManager);
  updateProcessingRates(state, instrumentation, providerManager);
}

/**
 * Handle provider.rate_limited event
 */
function handleProviderRateLimited(
  state: DashboardState,
  event: Extract<ProviderEvent, { type: 'provider.rate_limited' }>
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.rateLimited++;
}

/**
 * Handle provider.backoff event
 */
function handleProviderBackoff(
  state: DashboardState,
  event: Extract<ProviderEvent, { type: 'provider.backoff' }>
): void {
  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.activeProvider === event.provider && stream.status === 'active') {
        stream.transientMessage = {
          type: 'backoff',
          expiresAt: performance.now() + event.delayMs,
        };
      }
    }
  }

  if (state.processing?.metadata?.activeProvider === event.provider && state.processing.status === 'active') {
    state.processing.metadata.transientMessage = {
      type: 'backoff',
      expiresAt: performance.now() + event.delayMs,
    };
  }
}

/**
 * Handle provider.failover event
 */
function handleProviderFailover(
  state: DashboardState,
  event: Extract<ProviderEvent, { type: 'provider.failover' }>
): void {
  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.activeProvider === event.from && stream.status === 'active') {
        stream.activeProvider = event.to;
        stream.transientMessage = {
          type: 'failover',
          text: `↻ switched to ${event.to} (${event.from} ${event.reason})`,
          expiresAt: performance.now() + FAILOVER_MESSAGE_DURATION_MS,
        };
      }
    }
  }

  if (state.processing?.metadata?.activeProvider === event.from && state.processing.status === 'active') {
    state.processing.metadata.activeProvider = event.to;
    state.processing.metadata.transientMessage = {
      type: 'failover',
      text: `↻ switched to ${event.to} (${event.from} ${event.reason})`,
      expiresAt: performance.now() + FAILOVER_MESSAGE_DURATION_MS,
    };
  }
}

/**
 * Handle process.started event
 */
function handleProcessStarted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'process.started' }>
): void {
  state.processing = {
    status: 'active',
    startedAt: performance.now(),
    totalRaw: event.totalRaw,
    processed: 0,
  };
}

/**
 * Handle process.completed event
 */
function handleProcessCompleted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'process.completed' }>
): void {
  if (!state.processing) return;

  state.processing.status = 'completed';
  state.processing.completedAt = performance.now();
  state.processing.totalProcessed = event.totalProcessed;

  state.isComplete = true;
  if (state.import?.startedAt) {
    state.totalDurationMs = performance.now() - state.import.startedAt;
  }
}

/**
 * Handle metadata.batch.completed event
 */
function handleMetadataBatchCompleted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'metadata.batch.completed' }>,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  if (!state.processing) return;

  if (!state.processing.metadata) {
    state.processing.metadata = {
      cached: 0,
      fetched: 0,
      activeProvider: state.currentProvider,
    };
  }

  state.processing.metadata.fetched += event.cacheMisses;
  state.processing.metadata.cached += event.cacheHits;

  // Compute rates now that metadata exists — catches up on requests that fired before creation
  updateProcessingRates(state, instrumentation, providerManager);
}

/**
 * Calculate current and max rate for a provider based on recent successful requests
 */
function calculateProviderRate(
  provider: string,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager,
  blockchain: string | undefined
): { currentRate: number; maxRate: number | undefined } {
  const now = performance.now();
  const windowStart = now - RATE_CALCULATION_WINDOW_MS;

  const recentSuccessful = instrumentation
    .getMetrics()
    .filter((m) => m.provider === provider && m.timestamp >= windowStart && m.status >= 200 && m.status < 300);

  const currentRate = recentSuccessful.length / (RATE_CALCULATION_WINDOW_MS / 1000);

  let maxRate: number | undefined;
  if (blockchain) {
    const providerInfo = providerManager.getProviders(blockchain).find((p) => p.name === provider);
    if (providerInfo) {
      maxRate = providerInfo.rateLimit.requestsPerSecond;
    }
  }

  return { currentRate, maxRate };
}

/**
 * Update stream rates from instrumentation data
 */
function updateStreamRates(
  state: DashboardState,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  if (!state.import) return;

  for (const stream of state.import.streams.values()) {
    if (!stream.activeProvider || stream.status !== 'active') continue;

    const { currentRate, maxRate } = calculateProviderRate(
      stream.activeProvider,
      instrumentation,
      providerManager,
      state.blockchain
    );

    stream.currentRate = currentRate;
    stream.maxRate = maxRate;
  }
}

/**
 * Handle process.batch.completed event — accumulate processed count
 */
function handleProcessBatchCompleted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'process.batch.completed' }>
): void {
  if (!state.processing) return;

  state.processing.processed += event.batchSize;
}

/**
 * Handle scam.batch.summary event — accumulate scam stats, collect first 3 unique symbols
 */
function handleScamBatchSummary(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'scam.batch.summary' }>
): void {
  if (!state.processing) return;

  if (!state.processing.scams) {
    state.processing.scams = { total: 0, exampleSymbols: [] };
  }

  state.processing.scams.total += event.scamsFound;

  for (const symbol of event.exampleSymbols) {
    if (state.processing.scams.exampleSymbols.length >= 3) break;
    if (!state.processing.scams.exampleSymbols.includes(symbol)) {
      state.processing.scams.exampleSymbols.push(symbol);
    }
  }
}

/**
 * Update processing metadata rates from instrumentation data
 */
function updateProcessingRates(
  state: DashboardState,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  if (!state.processing?.metadata?.activeProvider || state.processing.status !== 'active') return;

  const { currentRate, maxRate } = calculateProviderRate(
    state.processing.metadata.activeProvider,
    instrumentation,
    providerManager,
    state.blockchain
  );

  state.processing.metadata.currentRate = currentRate;
  state.processing.metadata.maxRate = maxRate;
}
