import type { Account, AccountType, CursorState, ImportSession, RawTransactionInput, Result } from '@exitbook/core';

import type { FindOrCreateAccountParams } from './import-account-store.js';

export type { FindOrCreateAccountParams } from './import-account-store.js';

// ---------------------------------------------------------------------------
// Individual port interfaces
// ---------------------------------------------------------------------------

type ImportSessionStatus = 'started' | 'completed' | 'failed' | 'cancelled';

export interface IImportUserLookup {
  findOrCreateDefault(): Promise<Result<{ id: number }, Error>>;
}

export interface IImportAccountStore {
  findOrCreate(params: FindOrCreateAccountParams): Promise<Result<Account, Error>>;
  findAll(filters: {
    accountType?: AccountType | undefined;
    parentAccountId?: number | undefined;
    sourceName?: string | undefined;
    userId?: number | undefined;
  }): Promise<Result<Account[], Error>>;
  update(id: number, updates: { metadata?: Record<string, unknown> | undefined }): Promise<Result<void, Error>>;
  updateCursor(id: number, streamType: string, cursor: CursorState): Promise<Result<void, Error>>;
}

export interface IImportSessionStore {
  create(accountId: number): Promise<Result<number, Error>>;
  findLatestIncomplete(accountId: number): Promise<Result<ImportSession | undefined, Error>>;
  update(
    sessionId: number,
    updates: {
      error_message?: string | undefined;
      status?: ImportSessionStatus | undefined;
      transactions_imported?: number | undefined;
      transactions_skipped?: number | undefined;
    }
  ): Promise<Result<void, Error>>;
  finalize(
    sessionId: number,
    status: ImportSessionStatus,
    startTime: number,
    imported: number,
    skipped: number,
    errorMessage?: string,
    metadata?: Record<string, unknown>
  ): Promise<Result<void, Error>>;
  findById(sessionId: number): Promise<Result<ImportSession | undefined, Error>>;
}

export interface IImportRawTransactionSink {
  createBatch(
    accountId: number,
    transactions: RawTransactionInput[]
  ): Promise<Result<{ inserted: number; skipped: number }, Error>>;
  countByStreamType(accountId: number): Promise<Result<Map<string, number>, Error>>;
}

// ---------------------------------------------------------------------------
// Aggregate port — injected into ImportWorkflow
// ---------------------------------------------------------------------------

/**
 * All driven ports required by the import workflow.
 * Constructed in the composition root (CLI) and injected into ImportWorkflow.
 */
export interface ImportPorts {
  users: IImportUserLookup;
  accounts: IImportAccountStore;
  importSessions: IImportSessionStore;
  rawTransactions: IImportRawTransactionSink;

  /** Invalidate processed-transactions and cascade to downstream projections. */
  invalidateProjections(reason: string): Promise<Result<void, Error>>;

  /** Execute a callback where all port operations share a single atomic transaction. */
  withTransaction<T>(fn: (txPorts: ImportPorts) => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
