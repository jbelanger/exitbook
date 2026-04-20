import { performance } from 'node:perf_hooks';

import { describe, expect, it, vi } from 'vitest';

import { batchImportMonitorReducer } from '../batch-import-monitor-controller.js';
import { createBatchImportMonitorState } from '../batch-import-monitor-state.js';

const instrumentation = {} as never;
const providerRuntime = {} as never;

function dispatchEvent(state: ReturnType<typeof createBatchImportMonitorState>, event: object) {
  return batchImportMonitorReducer(state, {
    type: 'event',
    event: event as never,
    instrumentation,
    providerRuntime,
  });
}

describe('batchImportMonitorReducer', () => {
  it('tracks batch account progress and forwards detail events to the active monitor', () => {
    let state = createBatchImportMonitorState();

    state = dispatchEvent(state, {
      type: 'batch.started',
      profileDisplayName: 'Default',
      rows: [
        {
          accountId: 11,
          accountType: 'exchange-api',
          name: 'kraken-main',
          platformKey: 'kraken',
          syncMode: 'incremental',
        },
      ],
    });

    state = dispatchEvent(state, {
      type: 'batch.account.started',
      accountId: 11,
      index: 0,
    });

    state = dispatchEvent(state, {
      type: 'import.started',
      accountId: 11,
      isNewAccount: false,
      platformKey: 'kraken',
      platformKind: 'exchange-api',
      transactionCounts: new Map([['trades', 10]]),
    });

    state = dispatchEvent(state, {
      type: 'import.batch',
      accountId: 11,
      batchInserted: 3,
      batchSkipped: 1,
      deduplicated: 0,
      fetched: 4,
      isComplete: true,
      platformKey: 'kraken',
      streamType: 'trades',
      totalFetchedRun: 4,
      totalImported: 3,
      totalSkipped: 1,
    });

    state = dispatchEvent(state, {
      type: 'batch.account.completed',
      accountId: 11,
      imported: 3,
      skipped: 1,
    });

    state = dispatchEvent(state, {
      type: 'batch.completed',
      completedCount: 1,
      failedCount: 0,
      totalCount: 1,
    });

    expect(state.profileDisplayName).toBe('Default');
    expect(state.activeAccountId).toBe(11);
    expect(state.activeName).toBe('kraken-main');
    expect(state.activePlatformKey).toBe('kraken');
    expect(state.activeSyncMode).toBe('incremental');
    expect(state.completedCount).toBe(1);
    expect(state.failedCount).toBe(0);
    expect(state.isComplete).toBe(true);
    expect(state.totalCount).toBe(1);
    expect(state.totalDurationMs).toEqual(expect.any(Number));
    expect(state.rows).toEqual([
      expect.objectContaining({
        accountId: 11,
        imported: 3,
        skipped: 1,
        status: 'completed',
      }),
    ]);
    expect(state.activeDetail?.import?.streams.get('trades')).toEqual(
      expect.objectContaining({
        imported: 3,
        status: 'completed',
      })
    );
  });

  it('marks failed accounts without losing imported and skipped counters', () => {
    let state = createBatchImportMonitorState();

    state = dispatchEvent(state, {
      type: 'batch.started',
      profileDisplayName: 'Default',
      rows: [
        {
          accountId: 21,
          accountType: 'blockchain',
          name: 'btc-wallet',
          platformKey: 'bitcoin',
          syncMode: 'first-sync',
        },
      ],
    });

    state = dispatchEvent(state, {
      type: 'batch.account.failed',
      accountId: 21,
      error: 'Provider timeout',
      imported: 5,
      skipped: 2,
    });

    expect(state.failedCount).toBe(1);
    expect(state.rows).toEqual([
      expect.objectContaining({
        accountId: 21,
        errorMessage: 'Provider timeout',
        imported: 5,
        skipped: 2,
        status: 'failed',
      }),
    ]);
  });

  it('propagates abort into the active detail monitor and completes the batch', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1450);

    let state = createBatchImportMonitorState();

    state = dispatchEvent(state, {
      type: 'batch.started',
      profileDisplayName: 'Default',
      rows: [
        {
          accountId: 31,
          accountType: 'exchange-api',
          name: 'coinbase-main',
          platformKey: 'coinbase',
          syncMode: 'resuming',
        },
      ],
    });

    state = dispatchEvent(state, {
      type: 'batch.account.started',
      accountId: 31,
      index: 0,
    });

    state = batchImportMonitorReducer(state, { type: 'abort' });

    expect(state.aborted).toBe(true);
    expect(state.isComplete).toBe(true);
    expect(state.totalDurationMs).toBe(450);
    expect(state.activeDetail).toEqual(
      expect.objectContaining({
        aborted: true,
        isComplete: true,
      })
    );

    nowSpy.mockRestore();
  });

  it('propagates reducer failures into the active detail monitor', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(2000).mockReturnValueOnce(2750);

    let state = createBatchImportMonitorState();

    state = dispatchEvent(state, {
      type: 'batch.started',
      profileDisplayName: 'Default',
      rows: [
        {
          accountId: 41,
          accountType: 'exchange-csv',
          name: 'kucoin-csv',
          platformKey: 'kucoin',
          syncMode: 'incremental',
        },
      ],
    });

    state = dispatchEvent(state, {
      type: 'batch.account.started',
      accountId: 41,
      index: 0,
    });

    state = batchImportMonitorReducer(state, {
      type: 'fail',
      errorMessage: 'Batch import failed',
    });

    expect(state.errorMessage).toBe('Batch import failed');
    expect(state.isComplete).toBe(true);
    expect(state.totalDurationMs).toBe(750);
    expect(state.activeDetail).toEqual(
      expect.objectContaining({
        errorMessage: 'Batch import failed',
        isComplete: true,
      })
    );

    nowSpy.mockRestore();
  });
});
