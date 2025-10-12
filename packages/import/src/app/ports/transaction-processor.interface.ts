import type { UniversalTransaction } from '@exitbook/core';
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
  process(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>>;
}
