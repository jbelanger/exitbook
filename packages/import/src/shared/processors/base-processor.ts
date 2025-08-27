import type { UniversalTransaction } from '@crypto/core';
import { validateUniversalTransactions } from '@crypto/core';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { IProcessor, StoredRawData } from './interfaces.ts';

/**
 * Base class providing common functionality for all processors.
 * Implements logging, error handling, and batch processing patterns.
 */
export abstract class BaseProcessor<TRawData> implements IProcessor<TRawData> {
  protected logger: Logger;

  constructor(protected sourceId: string) {
    this.logger = getLogger(`${sourceId}Processor`);
  }

  canProcess(sourceId: string, sourceType: string): boolean {
    return sourceId === this.sourceId && this.canProcessSpecific(sourceType);
  }

  /**
   * Subclasses should specify which source types they can handle.
   */
  protected abstract canProcessSpecific(sourceType: string): boolean;

  /**
   * Helper method to handle processing errors consistently.
   */
  protected handleProcessingError(error: unknown, rawData: StoredRawData<TRawData>, context: string): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Processing failed for ${rawData.sourceTransactionId} in ${context}: ${errorMessage}`);
    throw new Error(`${this.sourceId} processing failed: ${errorMessage}`);
  }

  async process(rawData: StoredRawData<TRawData>[]): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${rawData.length} raw data items for ${this.sourceId}`);

    const transactions: UniversalTransaction[] = [];
    const errors: string[] = [];
    let processed = 0;
    let failed = 0;

    for (const rawItem of rawData) {
      try {
        const transaction = await this.processSingle(rawItem);
        if (transaction) {
          transactions.push(transaction);
          processed++;
        }
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const contextMessage = `Failed to process ${rawItem.sourceTransactionId}: ${errorMessage}`;
        errors.push(contextMessage);
        this.logger.warn(contextMessage);
      }
    }

    // NEW: Validate all generated transactions using Zod schemas
    const { invalid, valid } = validateUniversalTransactions(transactions);

    // Log validation errors but continue processing with valid transactions
    if (invalid.length > 0) {
      this.logger.error(
        `${invalid.length} invalid transactions from ${this.sourceId}Processor. ` +
          `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${transactions.length}. ` +
          `Errors: ${invalid
            .map(({ errors }) => errors.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
            .join(' | ')}`
      );
    }

    this.logger.info(
      `Processing completed for ${this.sourceId}: ${valid.length} valid, ${invalid.length} invalid, ${failed} failed`
    );

    if (errors.length > 0) {
      this.logger.warn(
        `Processing errors for ${this.sourceId}: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? '...' : ''}`
      );
    }

    return valid;
  }

  abstract processSingle(rawData: StoredRawData<TRawData>): Promise<UniversalTransaction | null>;

  /**
   * Helper method to validate required fields in raw data.
   */
  protected validateRequiredFields(rawData: Record<string, unknown>, requiredFields: string[], context: string): void {
    for (const field of requiredFields) {
      if (rawData[field] === undefined || rawData[field] === null) {
        throw new Error(`Missing required field '${field}' in ${context}`);
      }
    }
  }
}
