// Database schema types for data persistence
import type { DataSourceStatus } from '@exitbook/core';
import type { Selectable, Insertable, Updateable } from 'kysely';

import type { ExternalTransactionDataTable, DataSourcesTable, TransactionsTable } from '../schema/database-schema.js';

export type NewTransaction = Insertable<TransactionsTable>;
export type TransactionUpdate = Updateable<TransactionsTable>;

// Internal DB types for repository use
export type StoredDataSource = Selectable<DataSourcesTable>;
export type NewDataSource = Insertable<DataSourcesTable>;
export type DataSourceUpdate = Updateable<DataSourcesTable>;

// Internal DB types for raw data repository use
export type StoredRawData = Selectable<ExternalTransactionDataTable>;
export type NewRawData = Insertable<ExternalTransactionDataTable>;
export type RawDataUpdate = Updateable<ExternalTransactionDataTable>;

/**
 * Query filters for import sessions
 * Per ADR-007: Sessions are linked to accounts via account_id
 */
export interface SourceQuery {
  accountId?: number | undefined;
  limit?: number | undefined;
  since?: number | undefined;
  status?: DataSourceStatus | undefined;
}
