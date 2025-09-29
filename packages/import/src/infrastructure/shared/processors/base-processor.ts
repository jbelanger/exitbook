import type { UniversalTransaction } from '@crypto/core';
import { UniversalTransactionSchema } from '@crypto/core';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import type {
  IProcessor,
  ImportSessionMetadata,
  ProcessingImportSession,
} from '@exitbook/import/app/ports/processors.js';
import { type Result, ok, err } from 'neverthrow';

import { detectScamFromSymbol } from '../utils/scam-detection.js';

/**
 * Base class providing common functionality for all processors.
 */
export abstract class BaseProcessor implements IProcessor {
  protected logger: Logger;

  constructor(protected sourceId: string) {
    this.logger = getLogger(`${sourceId}Processor`);
  }

  /**
   * Subclasses must implement this method to handle normalized data.
   * This is the primary processing method that converts normalized blockchain/exchange data
   * into UniversalTransaction objects.
   */
  protected abstract processNormalizedInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>>;

  async process(importSession: ProcessingImportSession): Promise<Result<UniversalTransaction[], string>> {
    this.logger.info(`Processing ${importSession.normalizedData.length} normalized items for ${this.sourceId}`);

    const canProcessResult = this.canProcess(importSession.sourceId);
    if (canProcessResult.isErr()) {
      this.logger.warn(
        `Skipping processing for ${importSession.sourceId} of type ${importSession.sourceType} in ${this.sourceId}Processor`
      );
      return ok([]); // Return empty array for skipped processing
    }

    return (await this.processNormalizedInternal(importSession.normalizedData, importSession.sessionMetadata))
      .mapErr((error) => {
        this.logger.error(`Processing failed for ${this.sourceId}: ${error}`);
        return error;
      })
      .map((transactions) => this.postProcessTransactions(transactions));
  }

  /**
   * Apply scam detection to transactions using symbol-based detection.
   * Can be overridden by subclasses for more sophisticated detection.
   */
  protected applyScamDetection(transactions: UniversalTransaction[]): UniversalTransaction[] {
    return transactions.map((transaction) => {
      // Skip if transaction already has a note
      if (transaction.note) {
        return transaction;
      }

      // Apply scam detection based on symbol
      if (transaction.symbol) {
        const scamResult = detectScamFromSymbol(transaction.symbol);
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

  private canProcess(sourceId: string): Result<void, string> {
    return sourceId === this.sourceId
      ? ok()
      : err(`Cannot process sourceId ${sourceId} with processor for ${this.sourceId}`);
  }

  /**
   * Apply common post-processing to transactions including validation and scam detection.
   */
  private postProcessTransactions(transactions: UniversalTransaction[]): UniversalTransaction[] {
    const { invalid, valid } = validateUniversalTransactions(transactions).unwrapOr({ invalid: [], valid: [] });

    this.logValidationResults(valid, invalid, transactions.length);

    const processedTransactions = this.applyScamDetection(valid);

    this.logger.info(
      `Processing completed for ${this.sourceId}: ${processedTransactions.length} valid, ${invalid.length} invalid`
    );

    return processedTransactions;
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
