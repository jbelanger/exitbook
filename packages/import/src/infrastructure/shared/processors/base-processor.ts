import type { TransactionType, UniversalTransaction } from '@crypto/core';
import { UniversalTransactionSchema } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import { type Result } from 'neverthrow';

import type { IProcessor, ImportSessionMetadata, ProcessingImportSession } from '../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';
import { detectScamFromSymbol } from '../utils/scam-detection.js';

/**
 * Base class providing common functionality for all processors.
 * Implements logging, error handling, and batch processing patterns.
 */
export abstract class BaseProcessor implements IProcessor {
  protected logger: Logger;

  constructor(protected sourceId: string) {
    this.logger = getLogger(`${sourceId}Processor`);
  }

  canProcess(sourceId: string, sourceType: string): boolean {
    return sourceId === this.sourceId && this.canProcessSpecific(sourceType);
  }

  async process(importSession: ProcessingImportSession): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${importSession.rawDataItems.length} raw data items for ${this.sourceId}`);

    // Check if we have normalized data to process instead
    if (importSession.rawDataItems2 && importSession.rawDataItems2.length > 0) {
      this.logger.info(`Processing ${importSession.rawDataItems2.length} normalized items for ${this.sourceId}`);

      // Use the new normalized processing method
      const result = await this.processNormalizedInternal(importSession.rawDataItems2, importSession.sessionMetadata);

      if (result.isErr()) {
        this.logger.error(`Normalized processing failed for ${this.sourceId}: ${result.error}`);
        return [];
      }

      const transactions = result.value;

      // Validate all generated transactions using Zod schemas
      const { invalid, valid } = validateUniversalTransactions(transactions);

      // Log validation errors but continue processing with valid transactions
      if (invalid.length > 0) {
        this.logger.error(
          `${invalid.length} invalid transactions from ${this.sourceId}Processor. ` +
            `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${transactions.length}. ` +
            `Errors: ${invalid
              .map(({ errors }) => {
                // ZodError type import is not shown, so use 'any' for safe cast
                const zodError = errors as {
                  issues: { message: string; path: (string | number)[] }[];
                };
                return zodError.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
              })
              .join(' | ')}`
        );
      }

      // Apply scam detection to valid transactions
      const transactionsWithScamDetection = this.applyScamDetection(valid);

      this.logger.info(
        `Normalized processing completed for ${this.sourceId}: ${valid.length} valid, ${invalid.length} invalid`
      );

      return transactionsWithScamDetection;
    }

    // Fall back to original raw data processing
    const result = await this.processInternal(importSession.rawDataItems, importSession.sessionMetadata);

    if (result.isErr()) {
      this.logger.error(`Processing failed for ${this.sourceId}: ${result.error}`);
      return [];
    }

    const transactions = result.value;

    // Validate all generated transactions using Zod schemas
    const { invalid, valid } = validateUniversalTransactions(transactions);

    // Log validation errors but continue processing with valid transactions
    if (invalid.length > 0) {
      this.logger.error(
        `${invalid.length} invalid transactions from ${this.sourceId}Processor. ` +
          `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${transactions.length}. ` +
          `Errors: ${invalid
            .map(({ errors }) => {
              // ZodError type import is not shown, so use 'any' for safe cast
              const zodError = errors as {
                issues: { message: string; path: (string | number)[] }[];
              };
              return zodError.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
            })
            .join(' | ')}`
      );
    }

    // Apply scam detection to valid transactions
    const transactionsWithScamDetection = this.applyScamDetection(valid);

    this.logger.info(`Processing completed for ${this.sourceId}: ${valid.length} valid, ${invalid.length} invalid`);

    return transactionsWithScamDetection;
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

  /**
   * Subclasses should specify which source types they can handle.
   */
  protected abstract canProcessSpecific(sourceType: string): boolean;

  /**
   * Helper method to handle processing errors consistently.
   */
  protected handleProcessingError(error: unknown, rawData: StoredRawData, context: string): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Processing failed for ${rawData.id} in ${context}: ${errorMessage}`);
    throw new Error(`${this.sourceId} processing failed: ${errorMessage}`);
  }

  /**
   * Map blockchain transaction type to proper UniversalTransaction type based on fund direction.
   * Common logic used across all blockchain processors.
   */
  protected mapTransactionType(
    blockchainTransaction: UniversalBlockchainTransaction,
    sessionContext: ImportSessionMetadata
  ): TransactionType {
    const { amount, feeAmount, from, to } = blockchainTransaction;

    // Convert all wallet addresses to lowercase for case-insensitive comparison
    const allWalletAddresses = new Set([
      sessionContext.address?.toLowerCase(),
      ...(sessionContext.derivedAddresses || []).map((addr) => addr.toLowerCase()),
    ]);

    const isFromWallet = from && allWalletAddresses.has(from.toLowerCase());
    const isToWallet = to && allWalletAddresses.has(to.toLowerCase());

    // Check if this is a fee-only transaction (amount is 0 or equals fee, but fee > 0)
    const transactionAmount = parseFloat(amount || '0');
    const feeAmount_num = parseFloat(feeAmount || '0');
    const isFeeOnlyTransaction = transactionAmount === feeAmount_num && feeAmount_num > 0;

    if (isFeeOnlyTransaction) {
      return 'fee';
    }

    // Determine transaction type based on fund flow direction
    if (isFromWallet && isToWallet) {
      // Internal transfer between wallet addresses
      return 'transfer';
    } else if (!isFromWallet && isToWallet) {
      // Funds coming into wallet from external source
      return 'deposit';
    } else if (isFromWallet && !isToWallet) {
      // Funds going out of wallet to external address
      return 'withdrawal';
    } else {
      // Neither from nor to wallet addresses - shouldn't happen but default to transfer
      this.logger.warn(
        `Unable to determine transaction direction for ${blockchainTransaction.id}: from=${from}, to=${to}, wallet addresses: ${Array.from(allWalletAddresses).join(', ')}`
      );
      return 'transfer';
    }
  }

  /**
   * Subclasses implement this method to provide their specific processing logic.
   * The base class handles logging, error handling, and validation.
   */
  protected abstract processInternal(
    rawData: StoredRawData[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>>;

  /**
   * Subclasses can optionally implement this method to handle normalized data.
   * Used when the ingestion service has pre-normalized the raw data.
   * Default implementation delegates to processInternal for backward compatibility.
   */
  protected async processNormalizedInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    // Default implementation: treat normalized data as raw data for backward compatibility
    // Subclasses should override this to handle normalized data properly
    this.logger.warn(`${this.sourceId} processor does not implement processNormalizedInternal, using fallback`);

    // Create fake StoredRawData structure to maintain compatibility
    const fakeRawDataItems: StoredRawData[] = normalizedData.map((item, index) => ({
      createdAt: Date.now(),
      id: index,
      importSessionId: undefined,
      metadata: { providerId: this.sourceId },
      processingStatus: 'pending' as const,
      rawData: item,
      sourceId: this.sourceId,
      sourceType: 'blockchain' as const,
      updatedAt: Date.now(),
    }));

    return this.processInternal(fakeRawDataItems, sessionMetadata);
  }

  /**
   * Helper method to validate required fields in raw data.
   */
  protected validateRequiredFields(rawData: Record<string, unknown>, requiredFields: string[], context: string): void {
    for (const field of requiredFields) {
      if (rawData[field] === undefined || rawData[field] === undefined) {
        throw new Error(`Missing required field '${field}' in ${context}`);
      }
    }
  }
}

function validateUniversalTransactions(transactions: UniversalTransaction[]): {
  invalid: { errors: unknown; transaction: UniversalTransaction }[];
  valid: UniversalTransaction[];
} {
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

  return { invalid, valid };
}
