import type { TransactionType, UniversalTransaction } from '@crypto/core';
import { UniversalTransactionSchema } from '@crypto/core';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import { type Result } from 'neverthrow';

import type { IProcessor, ImportSessionMetadata, ProcessingImportSession } from '../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';
import { detectScamFromSymbol } from '../utils/scam-detection.js';

/**
 * Base class providing common functionality for all processors.
 *
 * Features:
 * - Unified processing pipeline for both raw and normalized data
 * - Consolidated validation and scam detection logic
 * - Consistent error handling and logging
 * - Support for multi-address session contexts
 *
 * Subclasses should implement:
 * - processNormalizedInternal() for normalized data processing
 * - canProcessSpecific() for source type filtering
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
    this.logger.info(`Processing ${importSession.normalizedData.length} normalized items for ${this.sourceId}`);

    const result = await this.processNormalizedInternal(importSession.normalizedData, importSession.sessionMetadata);

    if (result.isErr()) {
      this.logger.error(`Processing failed for ${this.sourceId}: ${result.error}`);
      return [];
    }

    // Apply common post-processing (validation and scam detection)
    return this.postProcessTransactions(result.value);
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
  protected handleProcessingError(error: unknown, itemId: string | number, context: string): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Processing failed for ${itemId} in ${context}: ${errorMessage}`);
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
   * Subclasses must implement this method to handle normalized data.
   * This is the primary processing method that converts normalized blockchain/exchange data
   * into UniversalTransaction objects.
   */
  protected abstract processNormalizedInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>>;

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

  /**
   * Apply common post-processing to transactions including validation and scam detection.
   * Consolidates logic that was previously duplicated between processing paths.
   */
  private postProcessTransactions(transactions: UniversalTransaction[]): UniversalTransaction[] {
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
