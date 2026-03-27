import type {
  Account,
  AccountType,
  ImportSession,
  ImportSessionStatus as CoreImportSessionStatus,
  RawTransactionInput,
} from '@exitbook/core';
import type { CursorState, Result } from '@exitbook/foundation';

// ---------------------------------------------------------------------------
// Individual port interfaces
// ---------------------------------------------------------------------------

export interface IImportAccountStore {
  create(params: {
    accountType: AccountType;
    identifier: string;
    parentAccountId: number;
    platformKey: string;
    profileId: number | undefined;
    providerName?: string | undefined;
  }): Promise<Result<Account, Error>>;
  findById(accountId: number): Promise<Result<Account | undefined, Error>>;
  findAll(filters: {
    accountType?: AccountType | undefined;
    parentAccountId?: number | undefined;
    platformKey?: string | undefined;
    profileId?: number | undefined;
  }): Promise<Result<Account[], Error>>;
  update(id: number, updates: { metadata?: Account['metadata'] | undefined }): Promise<Result<void, Error>>;
  updateCursor(id: number, streamType: string, cursor: CursorState): Promise<Result<void, Error>>;
}

export interface IImportSessionStore {
  create(accountId: number): Promise<Result<number, Error>>;
  findLatestIncomplete(accountId: number): Promise<Result<ImportSession | undefined, Error>>;
  update(
    sessionId: number,
    updates: {
      error_message?: string | undefined;
      status?: CoreImportSessionStatus | undefined;
      transactions_imported?: number | undefined;
      transactions_skipped?: number | undefined;
    }
  ): Promise<Result<void, Error>>;
  finalize(
    sessionId: number,
    params: {
      errorMessage?: string | undefined;
      imported: number;
      metadata?: Record<string, unknown> | undefined;
      skipped: number;
      startTime: number;
      status: Exclude<CoreImportSessionStatus, 'started'>;
    }
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
  accounts: IImportAccountStore;
  importSessions: IImportSessionStore;
  rawTransactions: IImportRawTransactionSink;

  /** Invalidate processed-transactions and cascade to downstream projections. */
  invalidateProjections(accountIds: number[] | undefined, reason: string): Promise<Result<void, Error>>;

  /** Execute a callback where all port operations share a single atomic transaction. */
  withTransaction<T>(fn: (txPorts: ImportPorts) => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
