import { performance } from 'node:perf_hooks';

import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { IngestionEvent } from '@exitbook/ingestion/events';
import type { InstrumentationCollector } from '@exitbook/observability';

import { updateStreamRates } from './ingestion-monitor-provider-updater.js';
import type { IngestionMonitorState, ImportOperation } from './ingestion-monitor-view-state.js';

export type IngestionImportEvent = Extract<
  IngestionEvent,
  {
    type:
      | 'xpub.derivation.started'
      | 'xpub.derivation.completed'
      | 'xpub.derivation.failed'
      | 'xpub.import.started'
      | 'xpub.import.completed'
      | 'xpub.import.failed'
      | 'xpub.empty'
      | 'import.started'
      | 'import.batch'
      | 'import.completed'
      | 'import.failed'
      | 'import.warning';
  }
>;

interface ImportUpdaterDeps {
  instrumentation: InstrumentationCollector;
  providerRuntime: IBlockchainProviderRuntime;
}

export function applyImportMonitorEvent(
  state: IngestionMonitorState,
  event: IngestionImportEvent,
  deps: ImportUpdaterDeps
): void {
  switch (event.type) {
    case 'xpub.derivation.started':
      handleXpubDerivationStarted(state, event);
      return;
    case 'xpub.derivation.completed':
      handleXpubDerivationCompleted(state, event);
      return;
    case 'xpub.derivation.failed':
      handleXpubDerivationFailed(state, event);
      return;
    case 'xpub.import.started':
      handleXpubImportStarted(state, event);
      return;
    case 'xpub.import.completed':
      handleXpubImportCompleted(state);
      return;
    case 'xpub.import.failed':
      handleXpubImportFailed(state, event);
      return;
    case 'xpub.empty':
      handleXpubEmpty(state);
      return;
    case 'import.started':
      handleImportStarted(state, event);
      return;
    case 'import.batch':
      handleImportBatch(state, event, deps);
      return;
    case 'import.completed':
      handleImportCompleted(state);
      return;
    case 'import.failed':
      handleImportFailed(state, event);
      return;
    case 'import.warning':
      handleImportWarning(state, event);
      return;
  }
}

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

  if (!state.account) {
    state.account = {
      id: event.parentAccountId,
      isNewAccount: event.parentIsNew,
      isXpubParent: true,
    };
    return;
  }

  state.account.isXpubParent = true;
}

function handleXpubDerivationCompleted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'xpub.derivation.completed' }>
): void {
  if (!state.derivation) return;

  state.derivation.status = 'completed';
  state.derivation.completedAt = performance.now();
  state.derivation.derivedCount = event.derivedCount;
  state.derivation.newCount = event.newCount;

  if (state.account) {
    state.account.childAccountCount = event.derivedCount;
  }
}

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
    return;
  }

  if (state.account.isXpubParent) {
    state.account.childAccountCount = event.childAccountCount;
  }
}

function handleXpubImportCompleted(state: IngestionMonitorState): void {
  if (!state.import) return;

  state.import.status = 'completed';
  state.import.completedAt = performance.now();

  if (!state.xpubImport) {
    return;
  }

  for (const stream of state.xpubImport.aggregatedStreams.values()) {
    if (stream.status !== 'active') {
      continue;
    }

    stream.status = 'completed';
    stream.completedAt = performance.now();
    stream.currentBatch = undefined;
  }
}

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

function handleXpubEmpty(state: IngestionMonitorState): void {
  state.isComplete = true;
  state.warnings.push({
    message: 'No active addresses found for xpub',
  });

  if (state.derivation) {
    state.totalDurationMs = performance.now() - state.derivation.startedAt;
  }
}

function handleImportStarted(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'import.started' }>
): void {
  if (event.parentAccountId && state.xpubImport) {
    return;
  }

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

function resolveStreamStartTime(importOperation: ImportOperation): number {
  const streams = Array.from(importOperation.streams.values());
  const lastStream = streams[streams.length - 1];
  return lastStream?.completedAt || importOperation.startedAt;
}

function handleImportBatch(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'import.batch' }>,
  deps: ImportUpdaterDeps
): void {
  if (!state.import) return;

  if (state.xpubImport) {
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
    return;
  }

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
    if (stream.status !== 'failed' && stream.status !== 'warning') {
      stream.status = 'completed';
    }
    stream.completedAt = performance.now();
    stream.currentBatch = undefined;
  }

  if (isNewStream) {
    updateStreamRates(state, deps.instrumentation, deps.providerRuntime);
  }
}

function handleImportCompleted(state: IngestionMonitorState): void {
  if (!state.import) return;

  state.import.status = 'completed';
  state.import.completedAt = performance.now();
}

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

function handleImportWarning(
  state: IngestionMonitorState,
  event: Extract<IngestionEvent, { type: 'import.warning' }>
): void {
  state.warnings.push({
    message: event.warning,
  });

  if (!event.streamType || !state.import) {
    return;
  }

  const stream = state.import.streams.get(event.streamType);
  if (!stream) {
    state.import.streams.set(event.streamType, {
      name: event.streamType,
      status: 'failed',
      startedAt: resolveStreamStartTime(state.import),
      imported: 0,
      currentBatch: 0,
      activeProvider: state.currentProvider,
      errorMessage: event.warning,
    });
    return;
  }

  stream.status = 'failed';
  stream.errorMessage = event.warning;
  if (!stream.completedAt) {
    stream.completedAt = performance.now();
  }
}
