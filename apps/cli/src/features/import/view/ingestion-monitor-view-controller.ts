/**
 * Dashboard State Updater - Pure functions to update state from events
 */

import { performance } from 'node:perf_hooks';

import { type IBlockchainProviderRuntime, type ProviderEvent } from '@exitbook/blockchain-providers';
import type { IngestionEvent } from '@exitbook/ingestion/events';
import type { InstrumentationCollector } from '@exitbook/observability';

import { applyImportMonitorEvent, type IngestionImportEvent } from './ingestion-monitor-import-updater.js';
import { applyProcessingMonitorEvent, type IngestionProcessingEvent } from './ingestion-monitor-processing-updater.js';
import { applyProviderMonitorEvent, type IngestionProviderEvent } from './ingestion-monitor-provider-updater.js';
import type { IngestionMonitorState } from './ingestion-monitor-view-state.js';

export type CliEvent = IngestionEvent | ProviderEvent;
export { applyImportMonitorEvent, applyProcessingMonitorEvent, applyProviderMonitorEvent };

/**
 * Actions that drive state transitions in the ingestion monitor UI.
 */
type IngestionMonitorAction =
  | {
      event: CliEvent;
      instrumentation: InstrumentationCollector;
      providerRuntime: IBlockchainProviderRuntime;
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
      updateStateFromEvent(next, action.event, action.instrumentation, action.providerRuntime);
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

export function applyIngestionMonitorEvent(
  state: IngestionMonitorState,
  event: CliEvent,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): IngestionMonitorState {
  return ingestionMonitorReducer(state, {
    type: 'event',
    event,
    instrumentation,
    providerRuntime,
  });
}

export function abortIngestionMonitor(state: IngestionMonitorState): IngestionMonitorState {
  return ingestionMonitorReducer(state, { type: 'abort' });
}

export function failIngestionMonitor(state: IngestionMonitorState, errorMessage: string): IngestionMonitorState {
  return ingestionMonitorReducer(state, { type: 'fail', errorMessage });
}

/**
 * Update dashboard state from event (mutates state in place for performance).
 */
function updateStateFromEvent(
  state: IngestionMonitorState,
  event: CliEvent,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): void {
  switch (event.type) {
    case 'xpub.derivation.started':
    case 'xpub.derivation.completed':
    case 'xpub.derivation.failed':
    case 'xpub.import.started':
    case 'xpub.import.completed':
    case 'xpub.import.failed':
    case 'xpub.empty':
    case 'import.started':
    case 'import.batch':
    case 'import.completed':
    case 'import.failed':
    case 'import.warning':
      applyImportMonitorEvent(state, event as IngestionImportEvent, { instrumentation, providerRuntime });
      return;

    case 'provider.selection':
    case 'provider.resume':
    case 'provider.request.started':
    case 'provider.request.succeeded':
    case 'provider.request.failed':
    case 'provider.rate_limited':
    case 'provider.backoff':
    case 'provider.failover':
      applyProviderMonitorEvent(state, event as IngestionProviderEvent, { instrumentation, providerRuntime });
      return;

    case 'clear.started':
    case 'clear.completed':
    case 'process.started':
    case 'process.batch.completed':
    case 'process.completed':
    case 'provider.metadata.batch.completed':
    case 'scam.batch.summary':
      applyProcessingMonitorEvent(state, event as IngestionProcessingEvent, { instrumentation, providerRuntime });
      return;

    // Events with no V3 dashboard representation
    case 'process.batch':
    case 'process.batch.started':
    case 'process.group.processing':
    case 'process.skipped':
    case 'process.failed':
    case 'provider.cursor.adjusted':
    case 'provider.circuit_open':
      return;

    default: {
      const exhaustiveCheck: never = event;
      return exhaustiveCheck;
    }
  }
}
