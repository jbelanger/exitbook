/**
 * Dashboard State Updater - Pure functions to update state from events
 */

import { performance } from 'node:perf_hooks';

import type { BlockchainProviderManager, ProviderEvent } from '@exitbook/blockchain-providers';
import type { IngestionEvent } from '@exitbook/ingestion';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { IngestionMonitorState, ImportOperation } from './ingestion-monitor-view-state.js';
import { getOrCreateProviderStats } from './ingestion-monitor-view-state.js';

export type CliEvent = IngestionEvent | ProviderEvent;

// Timing constants
const FAILOVER_MESSAGE_DURATION_MS = 3000;
const RATE_CALCULATION_WINDOW_MS = 5000;

/**
 * Actions that drive state transitions in the ingestion monitor UI.
 */
export type IngestionMonitorAction =
  | {
      event: CliEvent;
      instrumentation: InstrumentationCollector;
      providerManager: BlockchainProviderManager;
      type: 'event';
    }
  | { errorMessage: string; type: 'fail' }
  | { type: 'abort' }
  | { type: 'tick' };

/**
 * Reducer wrapper for ingestion monitor state.
 * Shallow-copies state before delegating to the mutable updater,
 * giving React a new top-level reference for change detection.
 */
export function ingestionMonitorReducer(
  state: IngestionMonitorState,
  action: IngestionMonitorAction
): IngestionMonitorState {
  switch (action.type) {
    case 'event': {
      const next = { ...state };
      updateStateFromEvent(next, action.event, action.instrumentation, action.providerManager);
      return next;
    }
    case 'abort': {
      if (state.isComplete) return state;
      return {
        ...state,
        aborted: true,
        isComplete: true,
        errorMessage: undefined,
        totalDurationMs: state.import?.startedAt ? performance.now() - state.import.startedAt : undefined,
      };
    }
    case 'fail': {
      if (state.isComplete) return state;
      const next: IngestionMonitorState = {
        ...state,
        errorMessage: action.errorMessage,
        aborted: false,
        isComplete: true,
        totalDurationMs: state.import?.startedAt ? performance.now() - state.import.startedAt : undefined,
      };
      if (state.processing && state.processing.status === 'active') {
        next.processing = { ...state.processing, status: 'failed', completedAt: performance.now() };
      }
      return next;
    }
    case 'tick':
      return { ...state };
  }
}

/**
 * Update dashboard state from event (mutates state in place for performance).
 */
export function updateStateFromEvent(
  state: IngestionMonitorState,
  event: CliEvent,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  switch (event.type) {
    // Xpub events
    case 'xpub.derivation.started':
      handleXpubDerivationStarted(state, event);
      break;

    case 'xpub.derivation.completed':
      handleXpubDerivationCompleted(state, event);
      break;

    case 'xpub.derivation.failed':
      handleXpubDerivationFailed(state, event);
      break;

    case 'xpub.import.started':
      handleXpubImportStarted(state, event);
      break;

    case 'xpub.import.completed':
      handleXpubImportCompleted(state, event);
      break;

    case 'xpub.import.failed':
      handleXpubImportFailed(state, event);
      break;

    case 'xpub.empty':
      handleXpubEmpty(state, event);
      break;

    // Regular import events
    case 'import.started':
      handleImportStarted(state, event);
      break;

    case 'import.batch':
      handleImportBatch(state, event, instrumentation, providerManager);
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
      handleProviderResume(state, event, providerManager);
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

    case 'clear.started':
      handleClearStarted(state, event);
      break;

    case 'clear.completed':
      handleClearCompleted(state, event);
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
 * Handle xpub.derivation.started event
 */
function handleXpubDerivationStarted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'xpub.derivation.started' }>
): void {
  state.derivation = {
    status: 'active',
    startedAt: performance.now(),
    isRederivation: event.isRederivation,
    gapLimit: event.gapLimit,
    previousGap: event.previousGap,
  };

  // Mark account as xpub parent
  if (!state.account) {
    state.account = {
      id: event.parentAccountId,
      isNewAccount: event.parentIsNew,
      isXpubParent: true,
    };
  } else {
    state.account.isXpubParent = true;
  }
}

/**
 * Handle xpub.derivation.completed event
 */
function handleXpubDerivationCompleted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'xpub.derivation.completed' }>
): void {
  if (!state.derivation) return;

  state.derivation.status = 'completed';
  state.derivation.completedAt = performance.now();
  state.derivation.derivedCount = event.derivedCount;
  state.derivation.newCount = event.newCount;

  // Update account info
  if (state.account) {
    state.account.childAccountCount = event.derivedCount;
  }
}

/**
 * Handle xpub.derivation.failed event
 */
function handleXpubDerivationFailed(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'xpub.derivation.failed' }>
): void {
  if (!state.derivation) return;

  state.derivation.status = 'failed';
  state.derivation.completedAt = performance.now();

  state.isComplete = true;
  state.errorMessage = `Failed to derive addresses: ${event.error}`;
  state.totalDurationMs = performance.now() - state.derivation.startedAt;
}

/**
 * Handle xpub.import.started event
 */
function handleXpubImportStarted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'xpub.import.started' }>
): void {
  state.xpubImport = {
    parentAccountId: event.parentAccountId,
    childAccountCount: event.childAccountCount,
    blockchain: event.blockchain,
    aggregatedStreams: new Map(),
  };

  // Create import operation (will be populated by child import events)
  state.import = {
    status: 'active',
    startedAt: performance.now(),
    streams: new Map(),
  };

  if (!state.account) {
    state.account = {
      id: event.parentAccountId,
      isNewAccount: event.parentIsNew,
      isXpubParent: true,
      childAccountCount: event.childAccountCount,
    };
  } else if (state.account.isXpubParent) {
    state.account.childAccountCount = event.childAccountCount;
  }
}

/**
 * Handle xpub.import.completed event
 */
function handleXpubImportCompleted(
  state: IngestionMonitorState,
  _event: Extract<IngestionEvent, { type: 'xpub.import.completed' }>
): void {
  if (!state.import) return;

  state.import.status = 'completed';
  state.import.completedAt = performance.now();

  // Mark all aggregated streams as completed
  if (state.xpubImport) {
    for (const stream of state.xpubImport.aggregatedStreams.values()) {
      if (stream.status === 'active') {
        stream.status = 'completed';
        stream.completedAt = performance.now();
        stream.currentBatch = undefined;
      }
    }
  }
}

/**
 * Handle xpub.import.failed event
 */
function handleXpubImportFailed(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'xpub.import.failed' }>
): void {
  if (!state.import) return;

  state.import.status = 'failed';
  state.import.completedAt = performance.now();

  state.isComplete = true;
  state.errorMessage = event.error;
  state.totalDurationMs = performance.now() - state.import.startedAt;
}

/**
 * Handle xpub.empty event
 */
function handleXpubEmpty(state: IngestionMonitorState, _event: Extract<IngestionEvent, { type: 'xpub.empty' }>): void {
  state.isComplete = true;
  state.warnings.push({
    message: 'No active addresses found for xpub',
  });

  if (state.derivation) {
    state.totalDurationMs = performance.now() - state.derivation.startedAt;
  }
}

/**
 * Handle import.started event
 */
function handleImportStarted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'import.started' }>
): void {
  // If this is a child of an xpub import, don't overwrite state
  if (event.parentAccountId && state.xpubImport) {
    // This is a child import - state.import already exists from xpub.import.started
    // Just track child account info
    return;
  }

  // Normal import (not xpub child)
  state.account = {
    id: event.accountId,
    isNewAccount: event.isNewAccount,
    transactionCounts: event.transactionCounts,
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
function handleImportBatch(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'import.batch' }>,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  if (!state.import) return;

  if (state.xpubImport) {
    // Aggregate into xpubImport.aggregatedStreams instead of per-account streams
    let stream = state.xpubImport.aggregatedStreams.get(event.streamType);

    if (!stream) {
      stream = {
        name: event.streamType,
        status: 'active',
        startedAt: state.import.startedAt,
        imported: 0,
        currentBatch: 0,
        activeProvider: state.currentProvider,
      };
      state.xpubImport.aggregatedStreams.set(event.streamType, stream);
    }

    stream.currentBatch = (stream.currentBatch || 0) + 1;
    stream.imported += event.batchInserted;

    // Do not mark aggregated streams complete here.
    // Completion is handled by xpub.import.completed after all children finish.
  } else {
    // Normal per-stream handling
    let stream = state.import.streams.get(event.streamType);
    const isNewStream = !stream;

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

    // Update rates for newly created streams (provider events may have fired before stream existed)
    if (isNewStream) {
      updateStreamRates(state, instrumentation, providerManager);
    }
  }
}

/**
 * Handle import.completed event
 */
function handleImportCompleted(state: IngestionMonitorState): void {
  if (!state.import) return;

  state.import.status = 'completed';
  state.import.completedAt = performance.now();
}

/**
 * Handle import.failed event
 */
function handleImportFailed(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'import.failed' }>
): void {
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
function handleImportWarning(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'import.warning' }>
): void {
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
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.selection' }>,
  providerManager: BlockchainProviderManager
): void {
  state.currentProvider = event.selected;
  state.blockchain = event.blockchain;

  // Set provider readiness on first selection (check import or derivation)
  if (!state.providerReadiness && (state.import || state.derivation)) {
    const availableProviders = providerManager.getProviders(event.blockchain);
    const startTime = state.import?.startedAt || state.derivation?.startedAt || performance.now();
    state.providerReadiness = {
      count: availableProviders.length,
      durationMs: performance.now() - startTime,
    };
  }

  // Update active provider for import streams
  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.status === 'active') {
        stream.activeProvider = event.selected;
      }
    }
  }

  // Update active provider for aggregated streams
  if (state.xpubImport) {
    for (const stream of state.xpubImport.aggregatedStreams.values()) {
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
function handleProviderResume(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.resume' }>,
  providerManager: BlockchainProviderManager
): void {
  state.currentProvider = event.provider;
  state.blockchain = event.blockchain;

  // Set provider readiness on first resume (same as selection, check import or derivation)
  if (!state.providerReadiness && (state.import || state.derivation)) {
    const availableProviders = providerManager.getProviders(event.blockchain);
    const startTime = state.import?.startedAt || state.derivation?.startedAt || performance.now();
    state.providerReadiness = {
      count: availableProviders.length,
      durationMs: performance.now() - startTime,
    };
  }

  // Update all active streams to use the resumed provider
  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.status === 'active') {
        stream.activeProvider = event.provider;
      }
    }
  }

  // Update active provider for aggregated streams
  if (state.xpubImport) {
    for (const stream of state.xpubImport.aggregatedStreams.values()) {
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
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.request.started' }>
): void {
  // Create provider stats on first request (shows footer immediately)
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.inFlightCount++; // Track in-flight requests for active status
  stats.total++; // Increment per-provider total
  state.apiCalls.total++; // Increment to show footer

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
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.request.succeeded' }>,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.inFlightCount = Math.max(0, stats.inFlightCount - 1); // Decrement in-flight count
  // Note: total is already incremented in request.started, don't increment again

  const count = stats.responsesByStatus.get(event.status) || 0;
  stats.responsesByStatus.set(event.status, count + 1);

  // Extract latency and timing from instrumentation
  const metric = instrumentation
    .getMetrics()
    .reverse()
    .find((m) => m.provider === event.provider && m.status === event.status);

  if (metric) {
    stats.latencies.push(metric.durationMs);
    stats.lastCallTime = metric.timestamp;

    if (stats.startTime === 0) {
      stats.startTime = metric.timestamp;
    }

    // Track ok count (2xx status codes except 429)
    if (event.status >= 200 && event.status < 300 && event.status !== 429) {
      stats.okCount++;
    }

    // Track throttled count (429)
    if (event.status === 429) {
      stats.throttledCount++;
    }
  }

  const { currentRate } = calculateProviderRate(event.provider, instrumentation, providerManager, state.blockchain);
  stats.currentRate = currentRate;

  updateStreamRates(state, instrumentation, providerManager);
  updateProcessingRates(state, instrumentation, providerManager);
}

/**
 * Handle provider.request.failed event
 */
function handleProviderRequestFailed(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.request.failed' }>,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.inFlightCount = Math.max(0, stats.inFlightCount - 1); // Decrement in-flight count
  // Note: total is already incremented in request.started, don't increment again

  // Only count as failed if it's not a 429
  // 429 is a throttle/rate-limit, not an error
  const is429 = event.status === 429;
  if (!is429) {
    stats.failed++;
  }

  if (event.status) {
    const count = stats.responsesByStatus.get(event.status) || 0;
    stats.responsesByStatus.set(event.status, count + 1);

    // Track throttled count for 429 responses
    if (event.status === 429) {
      stats.throttledCount++;
    }
  }

  // Extract latency and timing from instrumentation
  const metric = instrumentation
    .getMetrics()
    .reverse()
    .find((m) => m.provider === event.provider && (event.status ? m.status === event.status : true));

  if (metric) {
    stats.latencies.push(metric.durationMs);
    stats.lastCallTime = metric.timestamp;

    if (stats.startTime === 0) {
      stats.startTime = metric.timestamp;
    }
  }

  const { currentRate } = calculateProviderRate(event.provider, instrumentation, providerManager, state.blockchain);
  stats.currentRate = currentRate;

  updateStreamRates(state, instrumentation, providerManager);
  updateProcessingRates(state, instrumentation, providerManager);
}

/**
 * Handle provider.rate_limited event
 */
function handleProviderRateLimited(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.rate_limited' }>
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.throttledCount++;
}

/**
 * Handle provider.backoff event
 */
function handleProviderBackoff(
  state: IngestionMonitorState,
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
  state: IngestionMonitorState,
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
 * Handle clear.started event
 */
function handleClearStarted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'clear.started' }>
): void {
  state.clearing = {
    status: 'active',
    startedAt: performance.now(),
    transactions: event.preview.transactions,
  };
}

/**
 * Handle clear.completed event
 */
function handleClearCompleted(
  state: IngestionMonitorState,
  _event: Extract<IngestionEvent, { type: 'clear.completed' }>
): void {
  if (state.clearing) {
    state.clearing.status = 'completed';
    state.clearing.completedAt = performance.now();
  }
}

/**
 * Handle process.started event
 */
function handleProcessStarted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'process.started' }>
): void {
  // For reprocessing (no prior import), show account info if available
  if (!state.account && event.accountIds.length === 1 && event.accountTransactionCounts) {
    const accountId = event.accountIds[0]!; // Safe: length check guarantees element exists
    const transactionCounts = event.accountTransactionCounts.get(accountId);
    if (transactionCounts) {
      state.account = {
        id: accountId,
        isNewAccount: false,
        transactionCounts,
      };
    }
  }

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
  state: IngestionMonitorState,
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
  state: IngestionMonitorState,
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
  const now = Date.now();
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
  state: IngestionMonitorState,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  if (!state.import) return;

  // Update aggregated streams for xpub imports
  if (state.xpubImport) {
    for (const stream of state.xpubImport.aggregatedStreams.values()) {
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

  // Update regular streams for normal imports
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
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'process.batch.completed' }>
): void {
  if (!state.processing) return;

  state.processing.processed += event.batchSize;
}

/**
 * Handle scam.batch.summary event — accumulate scam stats, collect first 3 unique symbols
 */
function handleScamBatchSummary(
  state: IngestionMonitorState,
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
  state: IngestionMonitorState,
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
