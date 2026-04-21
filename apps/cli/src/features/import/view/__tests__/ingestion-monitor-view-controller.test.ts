import { performance } from 'node:perf_hooks';

import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { InstrumentationCollector } from '@exitbook/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  abortIngestionMonitor,
  applyImportMonitorEvent,
  applyProcessingMonitorEvent,
  applyProviderMonitorEvent,
  failIngestionMonitor,
} from '../ingestion-monitor-view-controller.js';
import { createIngestionMonitorState, type IngestionMonitorState } from '../ingestion-monitor-view-state.js';

interface FakeMetric {
  durationMs: number;
  provider: string;
  status: number;
  timestamp: number;
}

function createInstrumentation(metrics: FakeMetric[] = []) {
  return {
    metrics,
    collector: {
      getMetrics: () => [...metrics],
    } as InstrumentationCollector,
  };
}

function createProviderRuntime(): IBlockchainProviderRuntime {
  return {
    getProviders: () =>
      [
        { name: 'alchemy', rateLimit: { requestsPerSecond: 12 } },
        { name: 'routescan', rateLimit: { requestsPerSecond: 8 } },
      ] as never,
  } as unknown as IBlockchainProviderRuntime;
}

function createActiveProviderState(): IngestionMonitorState {
  const state = createIngestionMonitorState();
  state.blockchain = 'ethereum';
  state.import = {
    status: 'active',
    startedAt: 100,
    streams: new Map([
      [
        'transactions',
        {
          name: 'transactions',
          status: 'active',
          startedAt: 100,
          imported: 1,
          activeProvider: 'alchemy',
        },
      ],
    ]),
  };
  state.xpubImport = {
    parentAccountId: 1,
    childAccountCount: 2,
    blockchain: 'ethereum',
    aggregatedStreams: new Map([
      [
        'transactions',
        {
          name: 'transactions',
          status: 'active',
          startedAt: 100,
          imported: 4,
          activeProvider: 'alchemy',
        },
      ],
    ]),
  };
  state.processing = {
    status: 'active',
    startedAt: 100,
    totalRaw: 12,
    processed: 3,
    metadata: {
      cached: 0,
      fetched: 0,
      activeProvider: 'alchemy',
    },
  };
  return state;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyImportMonitorEvent', () => {
  it('creates failed stream state when a warning arrives before any batch', () => {
    const state = createIngestionMonitorState();
    const { collector } = createInstrumentation();
    const providerRuntime = createProviderRuntime();

    applyImportMonitorEvent(
      state,
      {
        type: 'import.started',
        accountId: 11,
        isNewAccount: false,
        platformKey: 'kraken',
        platformKind: 'exchange-api',
        transactionCounts: new Map([['trades', 2]]),
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    applyImportMonitorEvent(
      state,
      {
        type: 'import.warning',
        streamType: 'fills',
        warning: 'fills stream failed',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.warnings).toEqual([{ message: 'fills stream failed' }]);
    expect(state.import?.streams.get('fills')).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'fills stream failed',
        activeProvider: undefined,
      })
    );
  });

  it('keeps xpub aggregate streams active until the wrapper import completes', () => {
    const state = createIngestionMonitorState();
    const { collector } = createInstrumentation();
    const providerRuntime = createProviderRuntime();

    applyImportMonitorEvent(
      state,
      {
        type: 'xpub.import.started',
        parentAccountId: 22,
        parentIsNew: false,
        childAccountCount: 2,
        blockchain: 'bitcoin',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    applyImportMonitorEvent(
      state,
      {
        type: 'import.batch',
        accountId: 22,
        parentAccountId: 22,
        platformKey: 'bitcoin',
        streamType: 'transactions',
        batchInserted: 3,
        batchSkipped: 0,
        deduplicated: 0,
        fetched: 3,
        isComplete: true,
        totalFetchedRun: 3,
        totalImported: 3,
        totalSkipped: 0,
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.xpubImport?.aggregatedStreams.get('transactions')).toEqual(
      expect.objectContaining({
        imported: 3,
        status: 'active',
      })
    );

    applyImportMonitorEvent(
      state,
      {
        type: 'xpub.import.completed',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.import?.status).toBe('completed');
    expect(state.xpubImport?.aggregatedStreams.get('transactions')).toEqual(
      expect.objectContaining({
        imported: 3,
        status: 'completed',
        currentBatch: undefined,
      })
    );
  });
});

describe('applyProviderMonitorEvent', () => {
  it('syncs provider selection and resume across import, xpub, and processing state', () => {
    const state = createActiveProviderState();
    const { collector } = createInstrumentation();
    const providerRuntime = createProviderRuntime();
    vi.spyOn(performance, 'now').mockReturnValue(250);

    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.selection',
        selected: 'alchemy',
        blockchain: 'ethereum',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.currentProvider).toBe('alchemy');
    expect(state.providerReadiness).toEqual({
      count: 2,
      durationMs: 150,
    });
    expect(state.import?.streams.get('transactions')?.activeProvider).toBe('alchemy');
    expect(state.xpubImport?.aggregatedStreams.get('transactions')?.activeProvider).toBe('alchemy');
    expect(state.processing?.metadata?.activeProvider).toBe('alchemy');

    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.resume',
        provider: 'routescan',
        blockchain: 'ethereum',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.currentProvider).toBe('routescan');
    expect(state.import?.streams.get('transactions')?.activeProvider).toBe('routescan');
    expect(state.xpubImport?.aggregatedStreams.get('transactions')?.activeProvider).toBe('routescan');
    expect(state.processing?.metadata?.activeProvider).toBe('routescan');
  });

  it('tracks request telemetry counters, statuses, and derived rates', () => {
    const state = createActiveProviderState();
    const { collector, metrics } = createInstrumentation();
    const providerRuntime = createProviderRuntime();
    vi.spyOn(Date, 'now').mockReturnValue(5_000);

    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.request.started',
        provider: 'alchemy',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    const stats = state.apiCalls.byProvider.get('alchemy');
    expect(stats).toEqual(
      expect.objectContaining({
        inFlightCount: 1,
        total: 1,
      })
    );
    expect(state.apiCalls.total).toBe(1);

    metrics.push({ provider: 'alchemy', status: 200, durationMs: 120, timestamp: 4_500 });
    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.request.succeeded',
        provider: 'alchemy',
        status: 200,
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(stats).toEqual(
      expect.objectContaining({
        inFlightCount: 0,
        okCount: 1,
        currentRate: 0.2,
      })
    );
    expect(stats?.responsesByStatus.get(200)).toBe(1);
    expect(stats?.lastCallTime).toBe(4_500);
    expect(state.import?.streams.get('transactions')).toEqual(
      expect.objectContaining({
        currentRate: 0.2,
        maxRate: 12,
      })
    );
    expect(state.processing?.metadata).toEqual(
      expect.objectContaining({
        currentRate: 0.2,
        maxRate: 12,
      })
    );

    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.request.started',
        provider: 'alchemy',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    metrics.push({ provider: 'alchemy', status: 429, durationMs: 80, timestamp: 4_700 });
    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.request.failed',
        provider: 'alchemy',
        status: 429,
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(stats?.responsesByStatus.get(429)).toBe(1);
    expect(stats?.throttledCount).toBe(1);
    expect(stats?.failed).toBe(0);

    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.request.started',
        provider: 'alchemy',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    metrics.push({ provider: 'alchemy', status: 503, durationMs: 200, timestamp: 4_900 });
    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.request.failed',
        provider: 'alchemy',
        status: 503,
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(stats?.responsesByStatus.get(503)).toBe(1);
    expect(stats?.failed).toBe(1);
    expect(stats?.latencies).toEqual([120, 80, 200]);
  });

  it('writes transient provider backoff and failover messages for active work', () => {
    const state = createActiveProviderState();
    const { collector } = createInstrumentation();
    const providerRuntime = createProviderRuntime();
    vi.spyOn(performance, 'now').mockReturnValue(1_000);

    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.backoff',
        provider: 'alchemy',
        delayMs: 2_000,
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.import?.streams.get('transactions')?.transientMessage).toEqual({
      type: 'backoff',
      expiresAt: 3_000,
    });
    expect(state.processing?.metadata?.transientMessage).toEqual({
      type: 'backoff',
      expiresAt: 3_000,
    });

    applyProviderMonitorEvent(
      state,
      {
        type: 'provider.failover',
        from: 'alchemy',
        to: 'routescan',
        reason: 'rate-limited',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.import?.streams.get('transactions')).toEqual(
      expect.objectContaining({
        activeProvider: 'routescan',
        transientMessage: {
          type: 'failover',
          text: '↻ switched to routescan (alchemy rate-limited)',
          expiresAt: 4_000,
        },
      })
    );
    expect(state.processing?.metadata).toEqual(
      expect.objectContaining({
        activeProvider: 'routescan',
        transientMessage: {
          type: 'failover',
          text: '↻ switched to routescan (alchemy rate-limited)',
          expiresAt: 4_000,
        },
      })
    );
  });
});

describe('applyProcessingMonitorEvent', () => {
  it('tracks clear, process, metadata, and scam completion directly', () => {
    const state = createIngestionMonitorState();
    const { collector, metrics } = createInstrumentation([
      { provider: 'alchemy', status: 200, durationMs: 60, timestamp: 4_900 },
    ]);
    const providerRuntime = createProviderRuntime();
    vi.spyOn(performance, 'now').mockReturnValue(400);
    vi.spyOn(Date, 'now').mockReturnValue(5_000);

    state.currentProvider = 'alchemy';
    state.blockchain = 'ethereum';
    state.import = {
      status: 'active',
      startedAt: 50,
      streams: new Map(),
    };

    applyProcessingMonitorEvent(
      state,
      {
        type: 'clear.started',
        preview: { transactions: 12 },
      } as never,
      { instrumentation: collector, providerRuntime }
    );
    applyProcessingMonitorEvent(
      state,
      {
        type: 'clear.completed',
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(state.clearing).toEqual(
      expect.objectContaining({
        status: 'completed',
        transactions: 12,
      })
    );

    applyProcessingMonitorEvent(
      state,
      {
        type: 'process.started',
        accountIds: [11],
        accountTransactionCounts: new Map([[11, new Map([['trades', 4]])]]),
        totalRaw: 20,
      } as never,
      { instrumentation: collector, providerRuntime }
    );
    applyProcessingMonitorEvent(
      state,
      {
        type: 'provider.metadata.batch.completed',
        cacheHits: 3,
        cacheMisses: 2,
      } as never,
      { instrumentation: collector, providerRuntime }
    );
    applyProcessingMonitorEvent(
      state,
      {
        type: 'process.batch.completed',
        batchSize: 6,
      } as never,
      { instrumentation: collector, providerRuntime }
    );
    applyProcessingMonitorEvent(
      state,
      {
        type: 'scam.batch.summary',
        scamsFound: 4,
        exampleSymbols: ['SCAM', 'RUG', 'SCAM', 'PHISH'],
      } as never,
      { instrumentation: collector, providerRuntime }
    );
    applyProcessingMonitorEvent(
      state,
      {
        type: 'process.completed',
        totalProcessed: 20,
      } as never,
      { instrumentation: collector, providerRuntime }
    );

    expect(metrics).toHaveLength(1);
    expect(state.account).toEqual(
      expect.objectContaining({
        id: 11,
        transactionCounts: new Map([['trades', 4]]),
      })
    );
    expect(state.processing).toEqual(
      expect.objectContaining({
        status: 'completed',
        processed: 6,
        totalRaw: 20,
        totalProcessed: 20,
        scams: {
          total: 4,
          exampleSymbols: ['SCAM', 'RUG', 'PHISH'],
        },
      })
    );
    expect(state.processing?.metadata).toEqual(
      expect.objectContaining({
        cached: 3,
        fetched: 2,
        activeProvider: 'alchemy',
        currentRate: 0.2,
        maxRate: 12,
      })
    );
    expect(state.isComplete).toBe(true);
    expect(state.totalDurationMs).toBe(350);
  });
});

describe('ingestion monitor terminal wrappers', () => {
  it('marks abort and failure completion states without mutating callers in place', () => {
    vi.spyOn(performance, 'now').mockReturnValue(300);

    const abortState = createIngestionMonitorState();
    abortState.import = {
      status: 'active',
      startedAt: 100,
      streams: new Map(),
    };

    const aborted = abortIngestionMonitor(abortState);
    expect(aborted).not.toBe(abortState);
    expect(aborted).toEqual(
      expect.objectContaining({
        aborted: true,
        isComplete: true,
        totalDurationMs: 200,
      })
    );

    const failState = createIngestionMonitorState();
    failState.import = {
      status: 'active',
      startedAt: 100,
      streams: new Map(),
    };
    failState.processing = {
      status: 'active',
      startedAt: 150,
      totalRaw: 10,
      processed: 4,
    };

    const failed = failIngestionMonitor(failState, 'import blew up');
    expect(failed).not.toBe(failState);
    expect(failed).toEqual(
      expect.objectContaining({
        aborted: false,
        errorMessage: 'import blew up',
        isComplete: true,
        totalDurationMs: 200,
      })
    );
    expect(failed.processing).toEqual(
      expect.objectContaining({
        status: 'failed',
        completedAt: 300,
      })
    );
  });
});
