// Database schema types for data persistence
import type { DataSourceStatus, SourceType } from '@exitbook/core';
import type { Selectable, Insertable, Updateable } from 'kysely';

import type { ExternalTransactionDataTable, DataSourcesTable, TransactionsTable } from '../schema/database-schema.ts';

// Raw transaction type from database (with JSON strings)
// type OriginalTransaction = Selectable<TransactionsTable>;

// Transaction types using Kysely schema
// StoredTransaction has movements and fees deserialized from JSON strings to typed objects
// export type StoredTransaction = Omit<
//   OriginalTransaction,
//   'movements_inflows' | 'movements_outflows' | 'fees_network' | 'fees_platform' | 'fees_total'
// > & {
//   fees_network: AssetMovement | null;
//   fees_platform: AssetMovement | null;
//   fees_total: Money | null;
//   movements_inflows: AssetMovement[];
//   movements_outflows: AssetMovement[];
// };

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
