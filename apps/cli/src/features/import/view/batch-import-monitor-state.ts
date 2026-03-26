import type { Account } from '@exitbook/core';

import type { CliEvent } from './ingestion-monitor-view-controller.js';
import type { IngestionMonitorState } from './ingestion-monitor-view-state.js';

export type BatchImportSyncMode = 'first-sync' | 'incremental' | 'resuming';
export type BatchImportRowStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface BatchImportRow {
  accountId: number;
  accountType: Account['accountType'];
  errorMessage?: string | undefined;
  imported: number;
  name: string;
  platformKey: string;
  skipped: number;
  status: BatchImportRowStatus;
  syncMode: BatchImportSyncMode;
}

export interface BatchImportMonitorState {
  activeAccountId?: number | undefined;
  activeDetail?: IngestionMonitorState | undefined;
  activeIndex?: number | undefined;
  activeName?: string | undefined;
  activePlatformKey?: string | undefined;
  activeSyncMode?: BatchImportSyncMode | undefined;
  aborted: boolean;
  completedCount: number;
  errorMessage?: string | undefined;
  failedCount: number;
  isComplete: boolean;
  profileDisplayName?: string | undefined;
  rows: BatchImportRow[];
  startedAt?: number | undefined;
  totalCount: number;
  totalDurationMs?: number | undefined;
}

export interface BatchImportDescriptor {
  accountId: number;
  accountType: Account['accountType'];
  name: string;
  platformKey: string;
  syncMode: BatchImportSyncMode;
}

export type BatchImportMonitorEvent =
  | CliEvent
  | {
      profileDisplayName: string;
      rows: BatchImportDescriptor[];
      type: 'batch.started';
    }
  | {
      accountId: number;
      index: number;
      type: 'batch.account.started';
    }
  | {
      accountId: number;
      imported: number;
      skipped: number;
      type: 'batch.account.completed';
    }
  | {
      accountId: number;
      error: string;
      imported: number;
      skipped: number;
      type: 'batch.account.failed';
    }
  | {
      completedCount: number;
      failedCount: number;
      totalCount: number;
      type: 'batch.completed';
    };

export function createBatchImportMonitorState(): BatchImportMonitorState {
  return {
    aborted: false,
    completedCount: 0,
    failedCount: 0,
    isComplete: false,
    rows: [],
    totalCount: 0,
  };
}
