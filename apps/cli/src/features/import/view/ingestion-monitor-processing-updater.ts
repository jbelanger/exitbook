import { performance } from 'node:perf_hooks';

import type { IBlockchainProviderRuntime, ProviderEvent } from '@exitbook/blockchain-providers';
import type { IngestionEvent } from '@exitbook/ingestion/events';
import type { InstrumentationCollector } from '@exitbook/observability';

import { updateProcessingRates } from './ingestion-monitor-provider-updater.js';
import type { IngestionMonitorState } from './ingestion-monitor-view-state.js';

export type IngestionProcessingEvent =
  | Extract<
      IngestionEvent,
      {
        type:
          | 'clear.started'
          | 'clear.completed'
          | 'process.started'
          | 'process.batch.completed'
          | 'process.completed'
          | 'scam.batch.summary';
      }
    >
  | Extract<ProviderEvent, { type: 'provider.metadata.batch.completed' }>;

interface ProcessingUpdaterDeps {
  instrumentation: InstrumentationCollector;
  providerRuntime: IBlockchainProviderRuntime;
}

export function applyProcessingMonitorEvent(
  state: IngestionMonitorState,
  event: IngestionProcessingEvent,
  deps: ProcessingUpdaterDeps
): void {
  switch (event.type) {
    case 'clear.started':
      handleClearStarted(state, event);
      return;
    case 'clear.completed':
      handleClearCompleted(state);
      return;
    case 'process.started':
      handleProcessStarted(state, event);
      return;
    case 'process.batch.completed':
      handleProcessBatchCompleted(state, event);
      return;
    case 'process.completed':
      handleProcessCompleted(state, event);
      return;
    case 'provider.metadata.batch.completed':
      handleMetadataBatchCompleted(state, event, deps);
      return;
    case 'scam.batch.summary':
      handleScamBatchSummary(state, event);
      return;
  }
}

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

function handleClearCompleted(state: IngestionMonitorState): void {
  if (!state.clearing) return;

  state.clearing.status = 'completed';
  state.clearing.completedAt = performance.now();
}

function handleProcessStarted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'process.started' }>
): void {
  if (!state.account && event.accountIds.length === 1 && event.accountTransactionCounts) {
    const accountId = event.accountIds[0];
    if (accountId !== undefined) {
      const transactionCounts = event.accountTransactionCounts.get(accountId);
      if (transactionCounts) {
        state.account = {
          id: accountId,
          isNewAccount: false,
          transactionCounts,
        };
      }
    }
  }

  state.processing = {
    status: 'active',
    startedAt: performance.now(),
    totalRaw: event.totalRaw,
    processed: 0,
  };
}

function handleProcessBatchCompleted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'process.batch.completed' }>
): void {
  if (!state.processing) return;

  state.processing.processed += event.batchSize;
}

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

function handleMetadataBatchCompleted(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.metadata.batch.completed' }>,
  deps: ProcessingUpdaterDeps
): void {
  if (!state.processing) return;

  if (!state.processing.metadata) {
    state.processing.metadata = {
      cached: 0,
      fetched: 0,
      activeProvider: state.currentProvider,
    };
  }

  state.processing.metadata.fetched += event.providerFetches ?? event.cacheMisses;
  state.processing.metadata.cached += event.cacheHits;

  updateProcessingRates(state, deps.instrumentation, deps.providerRuntime);
}

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
    if (state.processing.scams.exampleSymbols.length >= 3) {
      break;
    }
    if (!state.processing.scams.exampleSymbols.includes(symbol)) {
      state.processing.scams.exampleSymbols.push(symbol);
    }
  }
}
