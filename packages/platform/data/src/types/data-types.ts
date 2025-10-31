// Database schema types for data persistence
import type { DataSourceStatus, SourceType } from '@exitbook/core';
import type { Selectable, Insertable, Updateable } from 'kysely';

import type { ExternalTransactionDataTable, DataSourcesTable, TransactionsTable } from '../schema/database-schema.ts';

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

export interface SourceQuery {
  limit?: number | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
  sourceType?: SourceType | undefined;
  status?: DataSourceStatus | undefined;
}
