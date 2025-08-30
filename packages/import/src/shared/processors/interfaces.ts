import type { UniversalTransaction } from '@crypto/core';
import { type Result } from 'neverthrow';

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
   * Process raw data into UniversalTransaction objects.
   */
  process(rawData: StoredRawData<TRawData>[]): Promise<UniversalTransaction[]>;
}

// New interfaces for the processor architecture refactor

/**
 * Validation result for raw data validation
 */
export interface ValidationResult {
  errors?: string[];
  isValid: boolean;
}

/**
 * Interface for provider-specific processors that handle validation and transformation
 */
export interface IProviderProcessor<TRawData> {
  /**
   * Transform validated raw data into blockchain transactions
   */
  transform(rawData: TRawData, walletAddresses: string[]): Result<UniversalTransaction, string>;
}

/**
 * Raw data tagged with the API client that fetched it
 */
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
