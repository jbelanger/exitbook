import type { UniversalTransaction } from '@crypto/core';
import { type Result } from 'neverthrow';

import type { UniversalBlockchainTransaction } from '../../blockchains/shared/types.ts';

export interface StoredRawData<TRawData = unknown> {
  createdAt: number;
  id: string;
  importSessionId?: string | undefined;
  metadata?: unknown;
  processedAt?: number | undefined;
  processingError?: string | undefined;
  processingStatus: string;
  rawData: TRawData;
  sourceId: string;
  sourceTransactionId: string;
  sourceType: string;
}

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
export interface IProcessor<TRawData> {
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
export interface IProviderProcessor<TRawData> {
  /**
   * Transform validated raw data into standardized blockchain transaction format.
   * Returns UniversalBlockchainTransaction for type-safe consumption by transaction processors.
   */
  transform(rawData: TRawData, sessionContext: ImportSessionMetadata): Result<UniversalBlockchainTransaction, string>;
}

/**
 * Raw data tagged with the API client that fetched it
 */
/**
 * Rich session metadata providing blockchain-specific address context
 */
export interface ImportSessionMetadata {
  // Provider-specific metadata
  [key: string]: unknown;

  // User-provided addresses for single-address blockchains
  addresses?: string[];

  // Bitcoin-specific metadata
  bitcoinDerivedAddresses?: {
    addresses: string[];
    derivationPath?: string;
    xpub?: string;
  };

  // Ethereum contract addresses for token transactions
  contractAddresses?: string[];

  // Bitcoin xpub-derived addresses for multi-address wallets
  derivedAddresses?: string[];

  // Full import parameters for context
  importParams?: {
    [key: string]: unknown;
    addresses?: string[];
    blockchain?: string;
    derivationPath?: string;
    exchange?: string;
  };
}

/**
 * Complete import session with metadata and raw data items
 */
export interface ProcessingImportSession {
  createdAt: number;
  // Session metadata
  id: string;
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
