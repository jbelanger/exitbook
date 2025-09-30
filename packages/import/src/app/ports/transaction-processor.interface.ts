import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import type { Result } from 'neverthrow';

export interface ProcessResult {
  errors: string[];
  failed: number;
  processed: number;
}

/**
 * Interface for processing raw data into UniversalTransaction format.
 * Each processor is responsible for converting source-specific raw data
 * into the standardized UniversalTransaction format.
 */
export interface ITransactionProcessor {
  /**
   * Process import sessions with rich context into UniversalTransaction objects.
   */
  process(importSession: ProcessingImportSession): Promise<Result<UniversalTransaction[], string>>;
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

/**
 * Complete import session with metadata and normalized data items
 */
export interface ProcessingImportSession {
  createdAt: number;
  // Session metadata
  id: number;
  // Normalized data items for this session (from potentially multiple providers)
  normalizedData: unknown[];
  // Rich session context with blockchain-specific metadata
  sessionMetadata?: ImportSessionMetadata | undefined;
  sourceId: string;

  sourceType: 'exchange' | 'blockchain';

  status: string;
}
