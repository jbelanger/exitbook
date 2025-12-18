import type { TransactionNote } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { type Result, err, ok } from 'neverthrow';

import type { ITransactionProcessor, ProcessingContext, ProcessedTransaction } from '../../shared/types/processors.js';
import { ProcessedTransactionSchema } from '../../shared/types/processors.js';
import type { ITokenMetadataService } from '../token-metadata/token-metadata-service.interface.js';

import { detectScamToken, detectScamFromSymbol } from './scam-detection-utils.js';

/**
 * Base class providing common functionality for all processors.
 */
export abstract class BaseTransactionProcessor implements ITransactionProcessor {
  protected logger: Logger;

  constructor(
    protected sourceName: string,
    protected tokenMetadataService?: ITokenMetadataService
  ) {
    this.logger = getLogger(`${sourceName}Processor`);
  }

  /**
   * Subclasses must implement this method to handle normalized data.
   * This is the primary processing method that converts normalized blockchain/exchange data
   * into ProcessedTransaction objects.
   */
  protected abstract processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>>;

  async process(
    normalizedData: unknown[],
    context?: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    this.logger.debug(`Processing ${normalizedData.length} items for ${this.sourceName}`);

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
   * Detect scam for a specific asset with optional contract address.
   * Called by blockchain processors that have contract address information.
   *
   * @param asset - Token symbol (e.g., "USDC")
   * @param contractAddress - Optional contract address for metadata lookup
   * @param transactionContext - Optional context about the transaction (amount, isAirdrop)
   * @returns TransactionNote if scam detected, undefined otherwise
   */
  protected async detectScamForAsset(
    asset: string,
    contractAddress?: string,
    transactionContext?: { amount: number; isAirdrop: boolean }
  ): Promise<TransactionNote | undefined> {
    // Tier 1: Full metadata-based detection (if service available and contract address provided)
    if (this.tokenMetadataService && contractAddress) {
      const metadataResult = await this.tokenMetadataService.getOrFetch(this.sourceName, contractAddress);
      if (metadataResult.isErr()) {
        this.logger.warn(
          { asset, contractAddress, error: metadataResult.error.message, source: this.sourceName },
          'Failed to fetch token metadata for scam detection'
        );
      } else if (metadataResult.value) {
        // Use full detection with all metadata fields and transaction context
        const scamNote = detectScamToken(contractAddress, metadataResult.value, transactionContext);
        if (scamNote) {
          this.logger.warn(
            {
              asset,
              contractAddress,
              detectionSource: scamNote.metadata?.detectionSource,
              indicators: scamNote.metadata?.indicators,
              source: 'metadata',
            },
            'Scam token detected via metadata'
          );
          return scamNote;
        }
      }
    }

    // Tier 2: Symbol-only detection (fallback when no contract address or metadata service)
    const scamResult = detectScamFromSymbol(asset);
    if (scamResult.isScam) {
      this.logger.warn({ asset, reason: scamResult.reason, source: 'symbol' }, 'Scam token detected via symbol check');
      return {
        message: `⚠️ Potential scam token (${asset}): ${scamResult.reason}`,
        metadata: { scamReason: scamResult.reason, scamAsset: asset, detectionSource: 'symbol' },
        severity: 'warning' as const,
        type: 'SCAM_TOKEN',
      };
    }

    return undefined;
  }

  /**
   * Apply common post-processing to transactions including validation.
   * Fails if any transactions are invalid to ensure atomicity.
   *
   * Note: Scam detection is NOT performed here. Each processor is responsible for
   * implementing scam detection during processing with the appropriate context
   * (contract addresses for blockchains, symbol-only for exchanges, etc.)
   */
  private postProcessTransactions(transactions: ProcessedTransaction[]): Result<ProcessedTransaction[], string> {
    const { invalid, valid } = validateProcessedTransactions(transactions).unwrapOr({ invalid: [], valid: [] });

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

    return ok(valid);
  }

  private formatZodErrors(errors: unknown): string {
    const zodError = errors as {
      issues: { message: string; path: (string | number)[] }[];
    };
    return zodError.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
}

function validateProcessedTransactions(transactions: ProcessedTransaction[]): Result<
  {
    invalid: { errors: unknown; transaction: ProcessedTransaction }[];
    valid: ProcessedTransaction[];
  },
  string
> {
  const valid: ProcessedTransaction[] = [];
  const invalid: { errors: unknown; transaction: ProcessedTransaction }[] = [];

  for (const tx of transactions) {
    const result = ProcessedTransactionSchema.safeParse(tx);
    if (result.success) {
      valid.push(tx);
    } else {
      invalid.push({ errors: result.error, transaction: tx });
    }
  }

  return ok({ invalid, valid });
}
