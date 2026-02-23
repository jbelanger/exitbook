import type { TokenMetadataRecord } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { type Result, err, ok } from 'neverthrow';
import type { z } from 'zod';

import type { ITransactionProcessor, AddressContext, ProcessedTransaction } from '../../shared/types/processors.js';
import { ProcessedTransactionSchema } from '../../shared/types/processors.js';
import type { IScamDetectionService, MovementWithContext } from '../scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../token-metadata/token-metadata-service.interface.js';

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
    protected tokenMetadataService?: ITokenMetadataService,
    protected scamDetectionService?: IScamDetectionService
  ) {
    this.logger = getLogger(`${sourceName}Processor`);
  }

  /** Zod schema used to validate and type each item before processing. */
  protected abstract get inputSchema(): z.ZodType<T>;

  /**
   * Subclasses must implement this method to handle normalized data.
   * This is the primary processing method that converts normalized blockchain/exchange data
   * into ProcessedTransaction objects.
   */
  protected abstract transformNormalizedData(
    normalizedData: T[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], string>>;

  async process(normalizedData: unknown[], context?: AddressContext): Promise<Result<ProcessedTransaction[], string>> {
    this.logger.debug(`Processing ${normalizedData.length} items for ${this.sourceName}`);

    const validated: T[] = [];
    for (let i = 0; i < normalizedData.length; i++) {
      const result = this.inputSchema.safeParse(normalizedData[i]);
      if (!result.success) {
        const errorDetail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        return err(`Input validation failed for ${this.sourceName} item at index ${i}: ${errorDetail}`);
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
   * Apply scam detection to transactions using pre-fetched metadata.
   * Call AFTER building all transactions but BEFORE returning from transformNormalizedData().
   *
   * @param transactions - All processed transactions
   * @param movements - Token movements with context from fund flow
   * @param metadataMap - Pre-fetched metadata (from single getOrFetchBatch call, may contain undefined for unfound contracts)
   */
  protected markScamTransactions(
    transactions: ProcessedTransaction[],
    movements: MovementWithContext[],
    metadataMap: Map<string, TokenMetadataRecord | undefined>
  ): void {
    if (!this.scamDetectionService) {
      return; // No service available
    }

    // Get scam notes keyed by transaction index
    const scamNotes = this.scamDetectionService.detectScams(movements, metadataMap, this.sourceName);

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
   * Enrich a pre-filtered list of items with token metadata via a single batch call.
   * Handles the empty-list early-return and delegates to tokenMetadataService.enrichBatch.
   * Subclasses are responsible for collecting the items to enrich before calling this.
   */
  protected async enrichWithTokenMetadata<TItem>(
    items: TItem[],
    chainName: string,
    extractAddress: (item: TItem) => string | undefined,
    applyMetadata: (item: TItem, metadata: TokenMetadataRecord) => void,
    canSkip?: (item: TItem) => boolean
  ): Promise<Result<void, Error>> {
    if (items.length === 0) return ok();

    this.logger.debug(`Enriching token metadata for ${items.length} items`);

    const result = await this.tokenMetadataService!.enrichBatch(
      items,
      chainName,
      extractAddress,
      applyMetadata,
      canSkip
    );

    if (result.isErr()) {
      return err(result.error);
    }

    this.logger.debug('Successfully enriched token metadata');
    return ok();
  }

  /**
   * Apply common post-processing to transactions including validation.
   * Fails if any transactions are invalid to ensure atomicity.
   *
   * Note: Scam detection is NOT performed here. Each processor is responsible for
   * implementing scam detection during processing with the appropriate context
   * (contract addresses for blockchains, symbol-only for exchanges, etc.)
   */
  private validateAndFilterTransactions(transactions: ProcessedTransaction[]): Result<ProcessedTransaction[], string> {
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
