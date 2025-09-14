import { type Result } from 'neverthrow';

import type { UniversalBlockchainTransaction } from '../../blockchains/shared/types.js';
import type { UniversalTransaction, StoredRawData } from '../../types.js';

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
export interface IProcessor {
  /**
   * Check if this processor can handle data from the specified adapter.
   */
  canProcess(sourceId: string, sourceType: string): boolean;

  /**
   * Process import sessions with rich context into UniversalTransaction objects.
   */
  process(importSession: ProcessingImportSession): Promise<UniversalTransaction[]>;
}

/**
 * Interface for provider-specific processors that handle validation and transformation
 */
export interface IRawDataMapper<TRawData> {
  /**
   * Transform validated raw data into standardized blockchain transaction format.
   * Returns array of UniversalBlockchainTransaction for type-safe consumption by transaction processors.
   * Single transactions should return array with one element, batch responses return multiple elements.
   */
  map(
    rawData: TRawData,
    sessionContext: ImportSessionMetadata,
  ): Result<UniversalBlockchainTransaction[], string>;
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
  derivedAddresses?: string[];
}

/**
 * Complete import session with metadata and raw data items
 */
export interface ProcessingImportSession {
  createdAt: number;
  // Session metadata
  id: number;
  // Raw data items for this session (from potentially multiple providers)
  rawDataItems: StoredRawData<ApiClientRawData<unknown>>[];
  // Rich session context with blockchain-specific metadata
  sessionMetadata?: ImportSessionMetadata | undefined;
  sourceId: string;

  sourceType: 'exchange' | 'blockchain';

  status: string;
}

export interface ApiClientRawData<TRawData> {
  providerId: string;
  rawData: TRawData;
  sourceAddress?: string | undefined; // Optional address context for the data
  transactionType?: string | undefined; // Optional transaction type for classification
}

/**
 * Result from failover execution that includes provenance
 */
export interface FailoverExecutionResult<T> {
  data: T;
  providerName: string;
}
