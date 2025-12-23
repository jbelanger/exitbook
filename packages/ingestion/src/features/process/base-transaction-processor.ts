import type { TokenMetadataRecord } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { type Result, err, ok } from 'neverthrow';

import type { ITransactionProcessor, ProcessingContext, ProcessedTransaction } from '../../shared/types/processors.js';
import { ProcessedTransactionSchema } from '../../shared/types/processors.js';
import type { IScamDetectionService, MovementWithContext } from '../scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../token-metadata/token-metadata-service.interface.js';

/**
 * Base class providing common functionality for all processors.
 */
export abstract class BaseTransactionProcessor implements ITransactionProcessor {
  protected logger: Logger;

  constructor(
    protected sourceName: string,
    protected tokenMetadataService?: ITokenMetadataService,
    protected scamDetectionService?: IScamDetectionService
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
   * Apply scam detection to transactions using pre-fetched metadata.
   * Call AFTER building all transactions but BEFORE returning from processInternal().
   *
   * @param transactions - All processed transactions
   * @param movements - Token movements with context from fund flow
   * @param metadataMap - Pre-fetched metadata (from single getOrFetchBatch call, may contain undefined for unfound contracts)
   */
  protected applyScamDetection(
    transactions: ProcessedTransaction[],
    movements: MovementWithContext[],
    metadataMap: Map<string, TokenMetadataRecord | undefined>
  ): void {
    if (!this.scamDetectionService) {
      return; // No service available
    }

    // Get scam notes keyed by transaction index
    const scamNotes = this.scamDetectionService.detectScams(movements, metadataMap);

    // Apply notes to transactions
    for (const [txIndex, note] of scamNotes) {
      const tx = transactions[txIndex];
      if (!tx) {
        this.logger.warn(`Transaction at index ${txIndex} not found when applying scam detection notes`);
        continue;
      }
      if (note.severity === 'error') {
        tx.isSpam = true;
      }
      tx.notes = [...(tx.notes || []), note];
    }
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
    const filteredTransactions = this.dropZeroValueContractInteractions(transactions);
    const { invalid, valid } = validateProcessedTransactions(filteredTransactions).unwrapOr({
      invalid: [],
      valid: [],
    });

    // STRICT MODE: Fail if any transactions are invalid
    if (invalid.length > 0) {
      const errorSummary = invalid.map(({ errors }) => this.formatZodErrors(errors)).join(' | ');

      this.logger.error(
        `CRITICAL: ${invalid.length} invalid transactions from ${this.sourceName}Processor. ` +
          `Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${filteredTransactions.length}. ` +
          `Errors: ${errorSummary}`
      );

      return err(
        `${invalid.length}/${filteredTransactions.length} transactions failed validation. ` +
          `This would corrupt portfolio calculations. Errors: ${errorSummary}`
      );
    }

    return ok(valid);
  }

  private dropZeroValueContractInteractions(transactions: ProcessedTransaction[]): ProcessedTransaction[] {
    if (transactions.length === 0) {
      return transactions;
    }

    const kept: ProcessedTransaction[] = [];
    let droppedCount = 0;
    for (const transaction of transactions) {
      if (this.shouldDropZeroValueContractInteraction(transaction)) {
        droppedCount += 1;
        continue;
      }
      kept.push(transaction);
    }

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

  private shouldDropZeroValueContractInteraction(transaction: ProcessedTransaction): boolean {
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
