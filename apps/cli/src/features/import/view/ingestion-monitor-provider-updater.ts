import { performance } from 'node:perf_hooks';

import { type IBlockchainProviderRuntime, type ProviderEvent } from '@exitbook/blockchain-providers';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { IngestionMonitorState } from './ingestion-monitor-view-state.js';
import { getOrCreateProviderStats } from './ingestion-monitor-view-state.js';

const FAILOVER_MESSAGE_DURATION_MS = 3000;
const RATE_CALCULATION_WINDOW_MS = 5000;

export type IngestionProviderEvent = Extract<
  ProviderEvent,
  {
    type:
      | 'provider.selection'
      | 'provider.resume'
      | 'provider.request.started'
      | 'provider.request.succeeded'
      | 'provider.request.failed'
      | 'provider.rate_limited'
      | 'provider.backoff'
      | 'provider.failover';
  }
>;

interface ProviderUpdaterDeps {
  instrumentation: InstrumentationCollector;
  providerRuntime: IBlockchainProviderRuntime;
}

export function applyProviderMonitorEvent(
  state: IngestionMonitorState,
  event: IngestionProviderEvent,
  deps: ProviderUpdaterDeps
): void {
  switch (event.type) {
    case 'provider.selection':
      handleProviderSelection(state, event, deps.providerRuntime);
      return;
    case 'provider.resume':
      handleProviderResume(state, event, deps.providerRuntime);
      return;
    case 'provider.request.started':
      handleProviderRequestStarted(state, event);
      return;
    case 'provider.request.succeeded':
      handleProviderRequestSucceeded(state, event, deps.instrumentation, deps.providerRuntime);
      return;
    case 'provider.request.failed':
      handleProviderRequestFailed(state, event, deps.instrumentation, deps.providerRuntime);
      return;
    case 'provider.rate_limited':
      handleProviderRateLimited(state, event);
      return;
    case 'provider.backoff':
      handleProviderBackoff(state, event);
      return;
    case 'provider.failover':
      handleProviderFailover(state, event);
      return;
  }
}

function syncProviderSelection(
  state: IngestionMonitorState,
  provider: string,
  blockchain: string,
  providerRuntime: IBlockchainProviderRuntime
): void {
  state.currentProvider = provider;
  state.blockchain = blockchain;

  if (!state.providerReadiness && (state.import || state.derivation)) {
    const availableProviders = providerRuntime.getProviders(blockchain);
    const startTime = state.import?.startedAt || state.derivation?.startedAt || performance.now();
    state.providerReadiness = {
      count: availableProviders.length,
      durationMs: performance.now() - startTime,
    };
  }

  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.status === 'active') {
        stream.activeProvider = provider;
      }
    }
  }

  if (state.xpubImport) {
    for (const stream of state.xpubImport.aggregatedStreams.values()) {
      if (stream.status === 'active') {
        stream.activeProvider = provider;
      }
    }
  }

  if (state.processing?.metadata) {
    state.processing.metadata.activeProvider = provider;
  }
}

function handleProviderSelection(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.selection' }>,
  providerRuntime: IBlockchainProviderRuntime
): void {
  syncProviderSelection(state, event.selected, event.blockchain, providerRuntime);
}

function handleProviderResume(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.resume' }>,
  providerRuntime: IBlockchainProviderRuntime
): void {
  syncProviderSelection(state, event.provider, event.blockchain, providerRuntime);
}

function handleProviderRequestStarted(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.request.started' }>
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.inFlightCount++;
  stats.total++;
  state.apiCalls.total++;

  if (state.import) {
    for (const stream of state.import.streams.values()) {
      if (stream.activeProvider === event.provider) {
        stream.transientMessage = undefined;
      }
    }
  }

  if (state.processing?.metadata?.activeProvider === event.provider) {
    state.processing.metadata.transientMessage = undefined;
  }
}

function handleProviderRequestSucceeded(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.request.succeeded' }>,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.inFlightCount = Math.max(0, stats.inFlightCount - 1);

  const count = stats.responsesByStatus.get(event.status) || 0;
  stats.responsesByStatus.set(event.status, count + 1);

  const metric = [...instrumentation.getMetrics()]
    .reverse()
    .find((candidate) => candidate.provider === event.provider && candidate.status === event.status);

  if (metric) {
    stats.latencies.push(metric.durationMs);
    stats.lastCallTime = metric.timestamp;

    if (stats.startTime === 0) {
      stats.startTime = metric.timestamp;
    }

    if (event.status >= 200 && event.status < 300 && event.status !== 429) {
      stats.okCount++;
    }

    if (event.status === 429) {
      stats.throttledCount++;
    }
  }

  const { currentRate } = calculateProviderRate(event.provider, instrumentation, providerRuntime, state.blockchain);
  stats.currentRate = currentRate;

  updateStreamRates(state, instrumentation, providerRuntime);
  updateProcessingRates(state, instrumentation, providerRuntime);
}

function handleProviderRequestFailed(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.request.failed' }>,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.inFlightCount = Math.max(0, stats.inFlightCount - 1);

  if (event.status !== 429) {
    stats.failed++;
  }

  if (event.status) {
    const count = stats.responsesByStatus.get(event.status) || 0;
    stats.responsesByStatus.set(event.status, count + 1);

    if (event.status === 429) {
      stats.throttledCount++;
    }
  }

  const metric = [...instrumentation.getMetrics()]
    .reverse()
    .find(
      (candidate) => candidate.provider === event.provider && (event.status ? candidate.status === event.status : true)
    );

  if (metric) {
    stats.latencies.push(metric.durationMs);
    stats.lastCallTime = metric.timestamp;

    if (stats.startTime === 0) {
      stats.startTime = metric.timestamp;
    }
  }

  const { currentRate } = calculateProviderRate(event.provider, instrumentation, providerRuntime, state.blockchain);
  stats.currentRate = currentRate;

  updateStreamRates(state, instrumentation, providerRuntime);
  updateProcessingRates(state, instrumentation, providerRuntime);
}

function handleProviderRateLimited(
  state: IngestionMonitorState,
  event: Extract<ProviderEvent, { type: 'provider.rate_limited' }>
): void {
  const stats = getOrCreateProviderStats(state, event.provider);
  stats.throttledCount++;
}

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

function calculateProviderRate(
  provider: string,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime,
  blockchain: string | undefined
): { currentRate: number; maxRate: number | undefined } {
  const now = Date.now();
  const windowStart = now - RATE_CALCULATION_WINDOW_MS;

  const recentSuccessful = instrumentation
    .getMetrics()
    .filter(
      (metric) =>
        metric.provider === provider && metric.timestamp >= windowStart && metric.status >= 200 && metric.status < 300
    );

  const currentRate = recentSuccessful.length / (RATE_CALCULATION_WINDOW_MS / 1000);

  let maxRate: number | undefined;
  if (blockchain) {
    const providerInfo = providerRuntime.getProviders(blockchain).find((candidate) => candidate.name === provider);
    if (providerInfo) {
      maxRate = providerInfo.rateLimit.requestsPerSecond;
    }
  }

  return { currentRate, maxRate };
}

export function updateStreamRates(
  state: IngestionMonitorState,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): void {
  if (!state.import) return;

  if (state.xpubImport) {
    for (const stream of state.xpubImport.aggregatedStreams.values()) {
      if (!stream.activeProvider || stream.status !== 'active') continue;

      const { currentRate, maxRate } = calculateProviderRate(
        stream.activeProvider,
        instrumentation,
        providerRuntime,
        state.blockchain
      );

      stream.currentRate = currentRate;
      stream.maxRate = maxRate;
    }
  }

  for (const stream of state.import.streams.values()) {
    if (!stream.activeProvider || stream.status !== 'active') continue;

    const { currentRate, maxRate } = calculateProviderRate(
      stream.activeProvider,
      instrumentation,
      providerRuntime,
      state.blockchain
    );

    stream.currentRate = currentRate;
    stream.maxRate = maxRate;
  }
}

export function updateProcessingRates(
  state: IngestionMonitorState,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): void {
  if (!state.processing?.metadata?.activeProvider || state.processing.status !== 'active') return;

  const { currentRate, maxRate } = calculateProviderRate(
    state.processing.metadata.activeProvider,
    instrumentation,
    providerRuntime,
    state.blockchain
  );

  state.processing.metadata.currentRate = currentRate;
  state.processing.metadata.maxRate = maxRate;
}
