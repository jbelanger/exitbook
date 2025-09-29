import type { UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';

import type { ApiClientRawData } from './importers.ts';

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

/**
 * Result from failover execution that includes provenance
 */
export interface FailoverExecutionResult<T> {
  data: T;
  providerName: string;
}
