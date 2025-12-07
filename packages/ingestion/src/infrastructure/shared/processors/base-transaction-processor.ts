import { UniversalTransactionSchema, type UniversalTransaction } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { type Result, err, ok } from 'neverthrow';

import type { ITransactionProcessor, ProcessingContext } from '../../../types/processors.js';
import { detectScamFromSymbol } from '../utils/scam-detection.js';

/**
 * Base class providing common functionality for all processors.
 */
export abstract class BaseTransactionProcessor implements ITransactionProcessor {
  protected logger: Logger;

  constructor(protected sourceName: string) {
    this.logger = getLogger(`${sourceName}Processor`);
  }

  /**
   * Subclasses must implement this method to handle normalized data.
   * This is the primary processing method that converts normalized blockchain/exchange data
   * into UniversalTransaction objects.
   */
  protected abstract processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<UniversalTransaction[], string>>;

  async process(
    normalizedData: unknown[],
    context?: ProcessingContext
  ): Promise<Result<UniversalTransaction[], string>> {
    this.logger.info(`Processing ${normalizedData.length} normalized items for ${this.sourceName}`);

    const result = await this.processInternal(normalizedData, context || { primaryAddress: '', userAddresses: [] });

    if (result.isErr()) {
      this.logger.error(`Processing failed for ${this.sourceName}: ${result.error}`);
      return result;
    }

    const postProcessResult = this.postProcessTransactions(result.value);

    if (postProcessResult.isErr()) {
      this.logger.error(`Post-processing failed for ${this.sourceName}: ${postProcessResult.error}`);
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

      // Check all assets (inflows and outflows) for scams
      const allAssets = new Set<string>();

      for (const inflow of transaction.movements?.inflows ?? []) {
        allAssets.add(inflow.asset);
      }

      for (const outflow of transaction.movements?.outflows ?? []) {
        allAssets.add(outflow.asset);
      }

      // Check each unique asset for scam patterns
      for (const asset of allAssets) {
        const scamResult = detectScamFromSymbol(asset);
        if (scamResult.isScam) {
          return {
            ...transaction,
            note: {
              message: `⚠️ Potential scam token (${asset}): ${scamResult.reason}`,
              metadata: { scamReason: scamResult.reason, scamAsset: asset },
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
        `CRITICAL: ${invalid.length} invalid transactions from ${this.sourceName}Processor. ` +
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
      `Processing completed for ${this.sourceName}: ${processedTransactions.length} transactions validated`
    );

    return ok(processedTransactions);
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
