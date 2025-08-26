import type { UniversalTransaction } from '@crypto/core';
import { validateUniversalTransactions } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import type { Logger } from '@crypto/shared-logger';

import type { IProcessor, StoredRawData } from './interfaces.ts';

/**
 * Base class providing common functionality for all processors.
 * Implements logging, error handling, and batch processing patterns.
 */
export abstract class BaseProcessor<TRawData> implements IProcessor<TRawData> {
  protected logger: Logger;

  constructor(protected adapterId: string) {
    this.logger = getLogger(`${adapterId}Processor`);
  }

  canProcess(adapterId: string, adapterType: string): boolean {
    return adapterId === this.adapterId && this.canProcessAdapterType(adapterType);
  }

  /**
   * Subclasses should specify which adapter types they can handle.
   */
  protected abstract canProcessAdapterType(adapterType: string): boolean;

  /**
   * Helper method to handle processing errors consistently.
   */
  protected handleProcessingError(error: unknown, rawData: StoredRawData<TRawData>, context: string): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Processing failed for ${rawData.sourceTransactionId} in ${context}: ${errorMessage}`);
    throw new Error(`${this.adapterId} processing failed: ${errorMessage}`);
  }

  async process(rawData: StoredRawData<TRawData>[]): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${rawData.length} raw data items for ${this.adapterId}`);

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
        `${invalid.length} invalid transactions from ${this.adapterId}Processor. ` +
          `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${transactions.length}. ` +
          `Errors: ${invalid
            .map(({ errors }) => errors.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
            .join(' | ')}`
      );
    }

    this.logger.info(
      `Processing completed for ${this.adapterId}: ${valid.length} valid, ${invalid.length} invalid, ${failed} failed`
    );

    if (errors.length > 0) {
      this.logger.warn(
        `Processing errors for ${this.adapterId}: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? '...' : ''}`
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
