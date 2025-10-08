// Database schema types for data persistence
import type { Selectable, Insertable, Updateable } from 'kysely';

import type {
  ExternalTransactionDataTable,
  ImportSessionErrorsTable,
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

export type ImportSessionError = Selectable<ImportSessionErrorsTable>;
export type NewImportSessionError = Insertable<ImportSessionErrorsTable>;
export type ImportSessionErrorUpdate = Updateable<ImportSessionErrorsTable>;

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
 * Import parameters that can be stored in session metadata
 */
export interface StoredImportParams {
  address?: string | undefined;
  csvDirectories?: string[] | undefined;
  exchangeCredentials?: Record<string, unknown> | undefined;
  providerId?: string | undefined;
}

/**
 * Rich session metadata providing blockchain-specific address context
 */
export interface ImportSessionMetadata {
  // User-provided address
  address?: string | undefined;

  // CSV import directories for exchange imports
  csvDirectories?: string[] | undefined;

  // Bitcoin xpub-derived addresses for multi-address wallets
  derivedAddresses?: string[] | undefined;

  // Import timestamp
  importedAt?: number | undefined;

  // Import parameters used for this session
  importParams?: StoredImportParams | undefined;

  // Additional provider-specific metadata
  [key: string]: unknown;
}
