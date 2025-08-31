import type { TransactionType, UniversalTransaction } from '@crypto/core';
import { validateUniversalTransactions } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import { type Result } from 'neverthrow';

import type { UniversalBlockchainTransaction } from '../../blockchains/shared/types.ts';
import { detectScamFromSymbol } from '../utils/scam-detection.ts';
import type { IProcessor, ImportSessionMetadata, ProcessingImportSession } from './interfaces.ts';

/**
 * Base class providing common functionality for all processors.
 * Implements logging, error handling, and batch processing patterns.
 */
export abstract class BaseProcessor<TRawData> implements IProcessor<TRawData> {
  protected logger: Logger;

  constructor(protected sourceId: string) {
    this.logger = getLogger(`${sourceId}Processor`);
  }

  /**
   * Apply scam detection to transactions using symbol-based detection.
   * Can be overridden by subclasses for more sophisticated detection.
   */
  protected applyScamDetection(transactions: UniversalTransaction[]): UniversalTransaction[] {
    return transactions.map(transaction => {
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
      ...(sessionContext.addresses || []).map(addr => addr.toLowerCase()),
      ...(sessionContext.derivedAddresses || []).map(addr => addr.toLowerCase()),
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

  async process(importSession: ProcessingImportSession): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${importSession.rawDataItems.length} raw data items for ${this.sourceId}`);

    // Delegate to subclass for actual processing logic
    const result = await this.processInternal(
      importSession.rawDataItems as StoredRawData<TRawData>[],
      importSession.sessionMetadata
    );

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
            .map(({ errors }) => errors.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
            .join(' | ')}`
      );
    }

    // Apply scam detection to valid transactions
    const transactionsWithScamDetection = this.applyScamDetection(valid);

    this.logger.info(`Processing completed for ${this.sourceId}: ${valid.length} valid, ${invalid.length} invalid`);

    return transactionsWithScamDetection;
  }

  /**
   * Subclasses implement this method to provide their specific processing logic.
   * The base class handles logging, error handling, and validation.
   */
  protected abstract processInternal(
    rawData: StoredRawData<TRawData>[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>>;

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
