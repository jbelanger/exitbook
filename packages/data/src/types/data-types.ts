// Database schema types for data persistence
import type { ImportSessionStatus } from '@exitbook/core';
import type { Selectable, Insertable, Updateable } from '@exitbook/sqlite';

import type { ImportSessionsTable, TransactionsTable } from '../schema/database-schema.js';

export type NewTransaction = Insertable<TransactionsTable>;
export type TransactionUpdate = Updateable<TransactionsTable>;

export type StoredImportSession = Selectable<ImportSessionsTable>;
export type NewImportSession = Insertable<ImportSessionsTable>;
export type ImportSessionUpdate = Updateable<ImportSessionsTable>;

/**
 * Query filters for import sessions
 * Per ADR-007: Sessions are linked to accounts via account_id
 */
export interface ImportSessionQuery {
  accountId?: number | undefined;
  limit?: number | undefined;
  since?: number | undefined;
  status?: ImportSessionStatus | undefined;
}
