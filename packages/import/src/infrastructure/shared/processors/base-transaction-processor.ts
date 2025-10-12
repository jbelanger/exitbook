import type { UniversalTransaction } from '@exitbook/core';
import type { ITransactionProcessor } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import { type Result, err, ok } from 'neverthrow';

import { UniversalTransactionSchema } from '../../blockchains/shared/schemas.ts';
import { detectScamFromSymbol } from '../utils/scam-detection.ts';

/**
 * Base class providing common functionality for all processors.
 */
export abstract class BaseTransactionProcessor implements ITransactionProcessor {
  protected logger: Logger;

  constructor(protected sourceId: string) {
    this.logger = getLogger(`${sourceId}Processor`);
  }

  /**
   * Subclasses must implement this method to handle normalized data.
   * This is the primary processing method that converts normalized blockchain/exchange data
   * into UniversalTransaction objects.
   */
  protected abstract processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>>;

  async process(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    this.logger.info(`Processing ${normalizedData.length} normalized items for ${this.sourceId}`);

    const result = await this.processInternal(normalizedData, sessionMetadata);

    if (result.isErr()) {
      this.logger.error(`Processing failed for ${this.sourceId}: ${result.error}`);
      return result;
    }

    const postProcessResult = this.postProcessTransactions(result.value);

    if (postProcessResult.isErr()) {
      this.logger.error(`Post-processing failed for ${this.sourceId}: ${postProcessResult.error}`);
      return postProcessResult;
    }

    return ok(postProcessResult.value);
  }

  /**
   * Apply scam detection to transactions using asset-based detection.
   * Can be overridden by subclasses for more sophisticated detection.
   */
  protected applyScamDetection(transactions: UniversalTransaction[]): UniversalTransaction[] {
    return transactions.map((transaction) => {
      // Skip if transaction already has a note
      if (transaction.note) {
        return transaction;
      }

      // Apply scam detection based on primary asset
      const primaryAsset = transaction.movements?.primary?.asset;
      if (primaryAsset) {
        const scamResult = detectScamFromSymbol(primaryAsset);
        if (scamResult.isScam) {
          return {
            ...transaction,
            note: {
              message: `⚠️ Potential scam token: ${scamResult.reason}`,
              metadata: { scamReason: scamResult.reason },
              severity: 'warning' as const,
              type: 'SCAM_TOKEN',
            },
          };
        }
      }

      return transaction;
    });
  }

  /**
   * Apply common post-processing to transactions including validation and scam detection.
   * Fails if any transactions are invalid to ensure atomicity.
   */
  private postProcessTransactions(transactions: UniversalTransaction[]): Result<UniversalTransaction[], string> {
    const { invalid, valid } = validateUniversalTransactions(transactions).unwrapOr({ invalid: [], valid: [] });

    // STRICT MODE: Fail if any transactions are invalid
    if (invalid.length > 0) {
      const errorSummary = invalid.map(({ errors }) => this.formatZodErrors(errors)).join(' | ');

      this.logger.error(
        `CRITICAL: ${invalid.length} invalid transactions from ${this.sourceId}Processor. ` +
          `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${transactions.length}. ` +
          `Errors: ${errorSummary}`
      );

      return err(
        `${invalid.length}/${transactions.length} transactions failed validation. ` +
          `This would corrupt portfolio calculations. Errors: ${errorSummary}`
      );
    }

    const processedTransactions = this.applyScamDetection(valid);

    this.logger.info(
      `Processing completed for ${this.sourceId}: ${processedTransactions.length} transactions validated`
    );

    return ok(processedTransactions);
  }

  private logValidationResults(
    valid: UniversalTransaction[],
    invalid: { errors: unknown; transaction: UniversalTransaction }[],
    total: number
  ): void {
    if (invalid.length === 0) return;

    const errorSummary = invalid.map(({ errors }) => this.formatZodErrors(errors)).join(' | ');

    this.logger.error(
      `${invalid.length} invalid transactions from ${this.sourceId}Processor. ` +
        `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${total}. ` +
        `Errors: ${errorSummary}`
    );
  }

  private formatZodErrors(errors: unknown): string {
    const zodError = errors as {
      issues: { message: string; path: (string | number)[] }[];
    };
    return zodError.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
}

function validateUniversalTransactions(transactions: UniversalTransaction[]): Result<
  {
    invalid: { errors: unknown; transaction: UniversalTransaction }[];
    valid: UniversalTransaction[];
  },
  string
> {
  const valid: UniversalTransaction[] = [];
  const invalid: { errors: unknown; transaction: UniversalTransaction }[] = [];

  for (const tx of transactions) {
    const result = UniversalTransactionSchema.safeParse(tx);
    if (result.success) {
      valid.push(tx);
    } else {
      invalid.push({ errors: result.error, transaction: tx });
    }
  }

  return ok({ invalid, valid });
}
