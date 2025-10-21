/**
 * Raw data tagged with the API client that fetched it
 */
/**
 * Import parameters that can be stored in session metadata
 */
export interface DataImportParams {
  address?: string | undefined;
  csvDirectories?: string[] | undefined;
  exchangeCredentials?: Record<string, unknown> | undefined;
  providerId?: string | undefined;
}

/**
 * Verification metadata stored in session
 */
export interface VerificationMetadata {
  current_balance: Record<string, string>;
  last_verification: BalanceVerification;
  source_params: SourceParams;
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
  importParams?: DataImportParams | undefined;

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
 * Domain model for data source sessions
 * Represents an import session with parsed JSON fields and camelCase naming
 */
export interface DataSource {
  id: number;
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date | undefined;
  createdAt: Date;
  updatedAt?: Date | undefined;
  durationMs?: number | undefined;
  errorMessage?: string | undefined;
  errorDetails?: unknown;
  importParams: DataImportParams;
  importResultMetadata: Record<string, unknown>;
  lastBalanceCheckAt?: Date | undefined;
  verificationMetadata?: VerificationMetadata | undefined;
}
