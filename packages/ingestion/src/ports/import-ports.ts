import type {
  Account,
  AccountType,
  ImportSession,
  ImportSessionStatus as CoreImportSessionStatus,
  RawTransactionInput,
} from '@exitbook/core';
import type { CursorState, Result } from '@exitbook/foundation';

export interface ImportAccountFilters {
  accountType?: AccountType | undefined;
  parentAccountId?: number | undefined;
  platformKey?: string | undefined;
  profileId?: number | undefined;
}

export interface CreateImportAccountInput {
  accountType: AccountType;
  identifier: string;
  parentAccountId: number;
  platformKey: string;
  profileId: number;
  providerName?: string | undefined;
}

export interface UpdateImportAccountInput {
  metadata?: Account['metadata'] | undefined;
}

export interface UpdateImportSessionInput {
  error_message?: string | undefined;
  status?: CoreImportSessionStatus | undefined;
  transactions_imported?: number | undefined;
  transactions_skipped?: number | undefined;
}

export interface FinalizeImportSessionInput {
  errorMessage?: string | undefined;
  imported: number;
  metadata?: Record<string, unknown> | undefined;
  skipped: number;
  startTime: number;
  status: Exclude<CoreImportSessionStatus, 'started'>;
}

/**
 * All driven ports required by the import workflow.
 * Constructed in the composition root (CLI) and injected into ImportWorkflow.
 */
export interface ImportPorts {
  createAccount(params: CreateImportAccountInput): Promise<Result<Account, Error>>;
  findAccountById(accountId: number): Promise<Result<Account | undefined, Error>>;
  findAccounts(filters: ImportAccountFilters): Promise<Result<Account[], Error>>;
  updateAccount(id: number, updates: UpdateImportAccountInput): Promise<Result<void, Error>>;
  updateAccountCursor(id: number, streamType: string, cursor: CursorState): Promise<Result<void, Error>>;

  createImportSession(accountId: number): Promise<Result<number, Error>>;
  findLatestIncompleteImportSession(accountId: number): Promise<Result<ImportSession | undefined, Error>>;
  updateImportSession(sessionId: number, updates: UpdateImportSessionInput): Promise<Result<void, Error>>;
  finalizeImportSession(sessionId: number, params: FinalizeImportSessionInput): Promise<Result<void, Error>>;
  findImportSessionById(sessionId: number): Promise<Result<ImportSession | undefined, Error>>;

  createRawTransactionBatch(
    accountId: number,
    transactions: RawTransactionInput[]
  ): Promise<Result<{ inserted: number; skipped: number }, Error>>;
  countRawTransactionsByStreamType(accountId: number): Promise<Result<Map<string, number>, Error>>;

  /** Invalidate processed-transactions and cascade to downstream projections. */
  invalidateProjections(accountIds: number[] | undefined, reason: string): Promise<Result<void, Error>>;

  /** Execute a callback where all port operations share a single atomic transaction. */
  withTransaction<T>(fn: (txPorts: ImportPorts) => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
