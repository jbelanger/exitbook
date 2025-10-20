// Database schema types for data persistence
import type { AssetMovement, Money } from '@exitbook/core';
import type { Selectable, Insertable, Updateable } from 'kysely';

import type {
  ExternalTransactionDataTable,
  ImportSessionErrorsTable,
  ImportSessionsTable,
  TransactionsTable,
} from '../schema/database-schema.ts';

// Raw transaction type from database (with JSON strings)
type RawStoredTransaction = Selectable<TransactionsTable>;

// Transaction types using Kysely schema
// StoredTransaction has movements and fees deserialized from JSON strings to typed objects
export type StoredTransaction = Omit<
  RawStoredTransaction,
  'movements_inflows' | 'movements_outflows' | 'fees_network' | 'fees_platform' | 'fees_total'
> & {
  fees_network: Money | null;
  fees_platform: Money | null;
  fees_total: Money | null;
  movements_inflows: AssetMovement[];
  movements_outflows: AssetMovement[];
};

export type NewTransaction = Insertable<TransactionsTable>;
export type TransactionUpdate = Updateable<TransactionsTable>;

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

/**
 * Source parameters identifying the wallet/account
 */
export type SourceParams =
  | {
      exchange: string;
    }
  | {
      address: string;
      blockchain: string;
    };

/**
 * Balance discrepancy details
 */
export interface BalanceDiscrepancy {
  asset: string;
  calculated: string;
  difference: string;
  live: string;
}

/**
 * Balance verification result
 */
export interface BalanceVerification {
  calculated_balance: Record<string, string>;
  discrepancies?: BalanceDiscrepancy[] | undefined;
  live_balance?: Record<string, string> | undefined;
  status: 'match' | 'mismatch' | 'unavailable';
  suggestions?: string[] | undefined;
  verified_at: string;
}

/**
 * Verification metadata stored in session
 */
export interface VerificationMetadata {
  current_balance: Record<string, string>;
  last_verification: BalanceVerification;
  source_params: SourceParams;
}
