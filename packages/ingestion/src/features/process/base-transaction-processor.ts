import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { TokenMetadataRecord, TransactionDraft } from '@exitbook/core';
import { TransactionDraftSchema, type Result, err, ok } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { z } from 'zod';

import type { ITransactionProcessor, AddressContext } from '../../shared/types/processors.js';
import type { IScamDetectionService, MovementWithContext } from '../scam-detection/scam-detection-service.interface.js';

/**
 * Base class providing common functionality for all processors.
 *
 * @template T - The normalized input type expected by this processor.
 *   Each item in `normalizedData` is validated against `inputSchema` before
 *   `transformNormalizedData` is called, eliminating unsafe casts.
 */
export abstract class BaseTransactionProcessor<T = unknown> implements ITransactionProcessor {
  protected logger: Logger;

  constructor(
    protected sourceName: string,
    protected providerManager?: BlockchainProviderManager,
    protected scamDetectionService?: IScamDetectionService
  ) {
    this.logger = getLogger(`${sourceName}Processor`);
  }

  /** Zod schema used to validate and type each item before processing. */
  protected abstract get inputSchema(): z.ZodType<T>;

  /**
   * Subclasses must implement this method to handle normalized data.
   * This is the primary processing method that converts normalized blockchain/exchange data
   * into TransactionDraft objects.
   */
  protected abstract transformNormalizedData(
    normalizedData: T[],
    context: AddressContext
  ): Promise<Result<TransactionDraft[], Error>>;

  async process(normalizedData: unknown[], context?: AddressContext): Promise<Result<TransactionDraft[], Error>> {
    this.logger.debug(`Processing ${normalizedData.length} items for ${this.sourceName}`);

    const validated: T[] = [];
    for (let i = 0; i < normalizedData.length; i++) {
      const result = this.inputSchema.safeParse(normalizedData[i]);
      if (!result.success) {
        const errorDetail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        return err(new Error(`Input validation failed for ${this.sourceName} item at index ${i}: ${errorDetail}`));
      }
      validated.push(result.data);
    }

    const result = await this.transformNormalizedData(validated, context || { primaryAddress: '', userAddresses: [] });

    if (result.isErr()) {
      this.logger.error(`Processing failed for ${this.sourceName}: ${result.error}`);
      return result;
    }

    const postProcessResult = this.validateAndFilterTransactions(result.value);

    if (postProcessResult.isErr()) {
      this.logger.error(`Post-processing failed for ${this.sourceName}: ${postProcessResult.error}`);
      return postProcessResult;
    }

    return ok(postProcessResult.value);
  }

  /**
   * Orchestrate scam detection: fetch token metadata in a single batch, then mark transactions.
   * Safe to call unconditionally — returns early when there are no movements or no scam
   * detection service. Falls back to symbol-only detection if the metadata fetch fails.
   */
  protected async runScamDetection(
    transactions: TransactionDraft[],
    movements: MovementWithContext[],
    chainName: string
  ): Promise<void> {
    if (movements.length === 0 || !this.scamDetectionService) {
      return;
    }

    const uniqueContracts = Array.from(new Set(movements.map((m) => m.contractAddress)));
    let metadataMap = new Map<string, TokenMetadataRecord | undefined>();
    let detectionMode: 'metadata' | 'symbol-only' = 'symbol-only';

    if (this.providerManager && uniqueContracts.length > 0) {
      const metadataResult = await this.providerManager.getTokenMetadata(chainName, uniqueContracts);
      if (metadataResult.isOk()) {
        metadataMap = metadataResult.value;
        detectionMode = 'metadata';
      } else {
        this.logger.warn(
          { error: metadataResult.error.message },
          'Metadata fetch failed for scam detection (falling back to symbol-only)'
        );
      }
    }

    this.markScamTransactions(transactions, movements, metadataMap);
    this.logger.debug(
      `Applied ${detectionMode} scam detection to ${transactions.length} transactions (${uniqueContracts.length} tokens)`
    );
  }

  /**
   * Apply scam detection to transactions using pre-fetched metadata.
   * Call AFTER building all transactions but BEFORE returning from transformNormalizedData().
   *
   * @param transactions - All processed transactions
   * @param movements - Token movements with context from fund flow
   * @param metadataMap - Pre-fetched metadata (from single getTokenMetadata call, may contain undefined for unfound contracts)
   */
  protected markScamTransactions(
    transactions: TransactionDraft[],
    movements: MovementWithContext[],
    metadataMap: Map<string, TokenMetadataRecord | undefined>
  ): void {
    if (!this.scamDetectionService) {
      return; // No service available
    }

    // Get scam notes keyed by transaction index
    const scamNotes = this.scamDetectionService.detectScams(movements, metadataMap, this.sourceName);

    // Apply notes to transactions
    for (const [txIndex, notes] of scamNotes) {
      const tx = transactions[txIndex];
      if (!tx) {
        this.logger.warn(`Transaction at index ${txIndex} not found when applying scam detection notes`);
        continue;
      }

      if (notes.some((note) => note.severity === 'error')) {
        tx.isSpam = true;
      }

      tx.notes = [...(tx.notes || []), ...notes];
    }
  }

  protected buildProcessingFailureError(failed: number, total: number, errors: { error: string; id: string }[]): Error {
    return new Error(
      `Cannot proceed: ${failed}/${total} transactions failed to process. ` +
        `Lost ${failed} transactions which would corrupt portfolio calculations. ` +
        `Errors: ${errors.map((e) => `[${e.id.substring(0, 10)}...]: ${e.error}`).join('; ')}`
    );
  }

  /**
   * Apply common post-processing to transactions including validation.
   * Fails if any transactions are invalid to ensure atomicity.
   *
   * Note: Scam detection is NOT performed here. Each processor is responsible for
   * implementing scam detection during processing with the appropriate context
   * (contract addresses for blockchains, symbol-only for exchanges, etc.)
   */
  private validateAndFilterTransactions(transactions: TransactionDraft[]): Result<TransactionDraft[], Error> {
    const filteredTransactions = this.dropZeroValueContractInteractions(transactions);
    const validationResult = validateProcessedTransactions(filteredTransactions);
    if (validationResult.isErr()) {
      return err(new Error(`Transaction validation failed: ${validationResult.error}`));
    }
    const { invalid, valid } = validationResult.value;

    // STRICT MODE: Fail if any transactions are invalid
    if (invalid.length > 0) {
      const errorSummary = invalid.map(({ errors }) => this.formatZodErrors(errors)).join(' | ');

      this.logger.error(
        `CRITICAL: ${invalid.length} invalid transactions from ${this.sourceName}Processor. ` +
          `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${filteredTransactions.length}. ` +
          `Errors: ${errorSummary}`
      );

      return err(
        new Error(
          `${invalid.length}/${filteredTransactions.length} transactions failed validation. ` +
            `This would corrupt portfolio calculations. Errors: ${errorSummary}`
        )
      );
    }

    return ok(valid);
  }

  private dropZeroValueContractInteractions(transactions: TransactionDraft[]): TransactionDraft[] {
    if (transactions.length === 0) {
      return transactions;
    }

    const kept = transactions.filter((tx) => !this.shouldDropZeroValueContractInteraction(tx));
    const droppedCount = transactions.length - kept.length;

    if (droppedCount > 0) {
      this.logger.warn(
        {
          source: this.sourceName,
          droppedCount,
          total: transactions.length,
        },
        'Dropped zero-value contract interactions with no movements or fees'
      );
    }

    return kept;
  }

  private shouldDropZeroValueContractInteraction(transaction: TransactionDraft): boolean {
    const notes = transaction.notes;
    if (!notes || !notes.some((note) => note.type === 'contract_interaction')) {
      return false;
    }

    const inflows = transaction.movements.inflows ?? [];
    const outflows = transaction.movements.outflows ?? [];
    const hasMovements = inflows.length > 0 || outflows.length > 0;
    const hasFees = transaction.fees.length > 0;

    return !hasMovements && !hasFees;
  }

  private formatZodErrors(errors: unknown): string {
    const zodError = errors as {
      issues: { message: string; path: (string | number)[] }[];
    };
    return zodError.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
}

function validateProcessedTransactions(transactions: TransactionDraft[]): Result<
  {
    invalid: { errors: unknown; transaction: TransactionDraft }[];
    valid: TransactionDraft[];
  },
  string
> {
  const valid: TransactionDraft[] = [];
  const invalid: { errors: unknown; transaction: TransactionDraft }[] = [];

  for (const tx of transactions) {
    const result = TransactionDraftSchema.safeParse(tx);
    if (result.success) {
      valid.push(tx);
    } else {
      invalid.push({ errors: result.error, transaction: tx });
    }
  }

  return ok({ invalid, valid });
}
