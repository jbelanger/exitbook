// Database schema types for data persistence
import type { Selectable, Insertable, Updateable } from 'kysely';

import type {
  ExternalTransactionDataTable,
  ImportSessionsTable,
  TransactionsTable,
  WalletAddressesTable,
} from '../schema/database-schema.ts';

// Transaction types using Kysely schema
export type StoredTransaction = Selectable<TransactionsTable>;
export type NewTransaction = Insertable<TransactionsTable>;
export type TransactionUpdate = Updateable<TransactionsTable>;

export type WalletAddress = Selectable<WalletAddressesTable>;
export type NewWalletAddress = Insertable<WalletAddressesTable>;
export type WalletAddressUpdate = Updateable<WalletAddressesTable>;

export type ImportSession = Selectable<ImportSessionsTable>;
export type NewImportSession = Insertable<ImportSessionsTable>;
export type ImportSessionUpdate = Updateable<ImportSessionsTable>;

export type RawData = Selectable<ExternalTransactionDataTable>;
export type NewRawData = Insertable<ExternalTransactionDataTable>;
export type RawDataUpdate = Updateable<ExternalTransactionDataTable>;

export interface ImportSessionQuery {
  limit?: number | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
  sourceType?: 'exchange' | 'blockchain' | undefined;
  status?: 'started' | 'completed' | 'failed' | 'cancelled' | undefined;
}

/**
 * Raw data tagged with the API client that fetched it
 */
/**
 * Rich session metadata providing blockchain-specific address context
 */
export interface ImportSessionMetadata {
  // User-provided address
  address?: string | undefined;

  // Bitcoin xpub-derived addresses for multi-address wallets
  derivedAddresses?: string[] | undefined;
}

export interface RawTransactionWithMetadata {
  metadata: RawTransactionMetadata;
  rawData: unknown;
}

export interface RawTransactionMetadata {
  providerId: string;
  sourceAddress?: string | undefined;
  transactionType?: string | undefined;
}
