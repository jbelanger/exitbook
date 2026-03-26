import { performance } from 'node:perf_hooks';

import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { BatchImportMonitorEvent, BatchImportMonitorState, BatchImportRow } from './batch-import-monitor-state.js';
import {
  applyIngestionMonitorEvent,
  abortIngestionMonitor,
  failIngestionMonitor,
  type CliEvent,
} from './ingestion-monitor-view-controller.js';
import { createIngestionMonitorState } from './ingestion-monitor-view-state.js';

type BatchImportMonitorAction =
  | {
      event: BatchImportMonitorEvent;
      instrumentation: InstrumentationCollector;
      providerRuntime: IBlockchainProviderRuntime;
      type: 'event';
    }
  | { errorMessage: string; type: 'fail' }
  | { type: 'abort' }
  | { type: 'tick' };

export function batchImportMonitorReducer(
  state: BatchImportMonitorState,
  action: BatchImportMonitorAction
): BatchImportMonitorState {
  switch (action.type) {
    case 'event':
      return updateBatchImportMonitorState(state, action.event, action.instrumentation, action.providerRuntime);
    case 'abort':
      return {
        ...state,
        aborted: true,
        isComplete: true,
        totalDurationMs: state.startedAt ? performance.now() - state.startedAt : undefined,
        activeDetail: state.activeDetail ? abortIngestionMonitor(state.activeDetail) : state.activeDetail,
      };
    case 'fail':
      return {
        ...state,
        errorMessage: action.errorMessage,
        isComplete: true,
        totalDurationMs: state.startedAt ? performance.now() - state.startedAt : undefined,
        activeDetail: state.activeDetail
          ? failIngestionMonitor(state.activeDetail, action.errorMessage)
          : state.activeDetail,
      };
    case 'tick':
      return { ...state };
  }
}

function updateBatchImportMonitorState(
  state: BatchImportMonitorState,
  event: BatchImportMonitorEvent,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): BatchImportMonitorState {
  switch (event.type) {
    case 'batch.started':
      return {
        ...state,
        aborted: false,
        completedCount: 0,
        failedCount: 0,
        isComplete: false,
        profileDisplayName: event.profileDisplayName,
        rows: event.rows.map<BatchImportRow>((row) => ({
          ...row,
          imported: 0,
          skipped: 0,
          status: 'pending',
        })),
        startedAt: performance.now(),
        totalCount: event.rows.length,
      };
    case 'batch.account.started': {
      const activeRow = state.rows.find((row) => row.accountId === event.accountId);
      return {
        ...state,
        activeAccountId: event.accountId,
        activeDetail: createIngestionMonitorState(),
        activeIndex: event.index,
        activeName: activeRow?.name,
        activePlatformKey: activeRow?.platformKey,
        activeSyncMode: activeRow?.syncMode,
        rows: state.rows.map((row) =>
          row.accountId === event.accountId
            ? {
                ...row,
                errorMessage: undefined,
                imported: 0,
                skipped: 0,
                status: 'active',
              }
            : row
        ),
      };
    }
    case 'batch.account.completed':
      return {
        ...state,
        completedCount: state.completedCount + 1,
        rows: state.rows.map((row) =>
          row.accountId === event.accountId
            ? {
                ...row,
                imported: event.imported,
                skipped: event.skipped,
                status: 'completed',
              }
            : row
        ),
      };
    case 'batch.account.failed':
      return {
        ...state,
        failedCount: state.failedCount + 1,
        rows: state.rows.map((row) =>
          row.accountId === event.accountId
            ? {
                ...row,
                errorMessage: event.error,
                imported: event.imported,
                skipped: event.skipped,
                status: 'failed',
              }
            : row
        ),
      };
    case 'batch.completed':
      return {
        ...state,
        completedCount: event.completedCount,
        failedCount: event.failedCount,
        isComplete: true,
        totalCount: event.totalCount,
        totalDurationMs: state.startedAt ? performance.now() - state.startedAt : undefined,
      };
    default:
      return updateBatchImportMonitorDetailState(state, event, instrumentation, providerRuntime);
  }
}

function updateBatchImportMonitorDetailState(
  state: BatchImportMonitorState,
  event: CliEvent,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): BatchImportMonitorState {
  if (!state.activeDetail) {
    return state;
  }

  const nextDetail = applyIngestionMonitorEvent(state.activeDetail, event, instrumentation, providerRuntime);

  if (event.type === 'import.batch') {
    return {
      ...state,
      activeDetail: nextDetail,
      rows: state.rows.map((row) =>
        row.accountId === state.activeAccountId
          ? {
              ...row,
              imported: event.totalImported,
              skipped: event.totalSkipped,
            }
          : row
      ),
    };
  }

  return {
    ...state,
    activeDetail: nextDetail,
  };
}
