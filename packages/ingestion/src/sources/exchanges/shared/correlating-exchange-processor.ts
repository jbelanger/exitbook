import { parseDecimal, type Currency, type OperationClassification } from '@exitbook/core';
import { err, ok, okAsync, type Result } from 'neverthrow';
import type { z } from 'zod';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { ProcessedTransaction } from '../../../shared/types/processors.js';

import {
  classifyExchangeOperationFromFundFlow,
  consolidateExchangeFees,
  consolidateExchangeMovements,
  detectExchangeClassificationUncertainty,
  selectPrimaryMovement,
} from './correlating-exchange-processor-utils.js';
import { ExchangeLedgerEntrySchema, type ExchangeLedgerEntry } from './schemas.js';
import {
  RawExchangeInputSchema,
  type FeeInput,
  type GroupingStrategy,
  type InterpretationStrategy,
  type LedgerEntryWithRaw,
  type MovementInput,
  type RawExchangeInput,
} from './strategies/index.js';
import type { ExchangeFundFlow } from './types.js';

/**
 * Base processor for exchange transactions using strategy composition.
 *
 * Subclasses implement normalizeEntry to convert raw exchange data into
 * ExchangeLedgerEntry. The base class then handles grouping, interpretation,
 * fund flow analysis, and ProcessedTransaction creation.
 *
 * @template TRaw - The raw exchange-specific type (e.g., RawCoinbaseLedgerEntry, KrakenLedgerEntry)
 */
export abstract class CorrelatingExchangeProcessor<TRaw = unknown> extends BaseTransactionProcessor<
  RawExchangeInput<TRaw>
> {
  constructor(
    sourceName: string,
    private grouping: GroupingStrategy,
    private interpretation: InterpretationStrategy<TRaw>
  ) {
    super(sourceName);
  }

  protected get inputSchema(): z.ZodType<RawExchangeInput<TRaw>> {
    return RawExchangeInputSchema as z.ZodType<RawExchangeInput<TRaw>>;
  }

  /**
   * Convert raw exchange data into the normalized ExchangeLedgerEntry contract.
   * Each exchange subclass implements this with exchange-specific parsing logic.
   */
  protected abstract normalizeEntry(raw: TRaw, eventId: string): Result<ExchangeLedgerEntry, Error>;

  /**
   * Validate a normalized entry against ExchangeLedgerEntrySchema.
   * Convenience for subclass normalizeEntry implementations.
   */
  protected validateNormalized(data: Record<string, unknown>): Result<ExchangeLedgerEntry, Error> {
    const result = ExchangeLedgerEntrySchema.safeParse(data);
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return err(new Error(`Normalized data validation failed: ${detail}`));
    }
    return ok(result.data);
  }

  protected async transformNormalizedData(
    rawInputs: RawExchangeInput<TRaw>[]
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Normalize raw inputs into LedgerEntryWithRaw via subclass normalizeEntry
    const entries: LedgerEntryWithRaw<TRaw>[] = [];
    for (const input of rawInputs) {
      const normalizeResult = this.normalizeEntry(input.raw, input.eventId);
      if (normalizeResult.isErr()) {
        return err(
          `Normalization failed for ${this.sourceName} entry ${input.eventId}: ${normalizeResult.error.message}`
        );
      }
      entries.push({
        raw: input.raw,
        normalized: normalizeResult.value,
        eventId: input.eventId,
      });
    }

    // Group using strategy (e.g., by correlationId, timestamp, or no grouping)
    const entryGroups = this.grouping.group(entries);

    this.logger.debug(`Created ${entryGroups.size} entry groups for ${this.sourceName}`);

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { correlationId: string; entryCount: number; error: string }[] = [];

    for (const [correlationId, entryGroup] of entryGroups) {
      const fundFlowResult = this.analyzeFundFlow(entryGroup);

      if (fundFlowResult.isErr()) {
        const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
        processingErrors.push({ correlationId, entryCount: entryGroup.length, error: errorMsg });
        this.logger.error(
          `${errorMsg} for ${this.sourceName} entry group ${correlationId} (${entryGroup.length} entries) - THIS TRANSACTION GROUP WILL BE LOST`
        );
        continue;
      }

      const fundFlow = fundFlowResult.value;
      const primaryEntry = this.selectPrimaryEntry(entryGroup, fundFlow);

      if (!primaryEntry) {
        const errorMsg = 'No primary entry found for correlated group';
        processingErrors.push({ correlationId, entryCount: entryGroup.length, error: errorMsg });
        this.logger.error(
          `${errorMsg} ${correlationId} (${entryGroup.length} entries) - THIS TRANSACTION GROUP WILL BE LOST. Group types: ${entryGroup.map((e) => e.normalized.type).join(', ')}`
        );
        continue;
      }

      const classification = this.determineOperationFromFundFlow(fundFlow, entryGroup);
      const normalizedDestinationAddress = primaryEntry.normalized.address?.trim();

      const processedTransaction: ProcessedTransaction = {
        externalId: primaryEntry.normalized.id,
        datetime: new Date(fundFlow.timestamp).toISOString(),
        timestamp: fundFlow.timestamp,
        source: this.sourceName,
        sourceType: 'exchange',
        status: primaryEntry.normalized.status,

        movements: {
          inflows: fundFlow.inflows.map((inflow) => {
            const gross = parseDecimal(inflow.grossAmount);
            const net = parseDecimal(inflow.netAmount ?? inflow.grossAmount);

            return {
              assetId: inflow.assetId,
              assetSymbol: inflow.assetSymbol as Currency,
              grossAmount: gross,
              netAmount: net,
            };
          }),

          outflows: fundFlow.outflows.map((outflow) => {
            const gross = parseDecimal(outflow.grossAmount);
            const net = parseDecimal(outflow.netAmount ?? outflow.grossAmount);

            return {
              assetId: outflow.assetId,
              assetSymbol: outflow.assetSymbol as Currency,
              grossAmount: gross,
              netAmount: net,
            };
          }),
        },

        fees: fundFlow.fees.map((fee) => ({
          assetId: fee.assetId,
          assetSymbol: fee.assetSymbol as Currency,
          amount: parseDecimal(fee.amount),
          scope: fee.scope,
          settlement: fee.settlement,
        })),

        operation: classification.operation,
        notes: classification.notes,
        ...(normalizedDestinationAddress ? { to: normalizedDestinationAddress } : {}),
        ...(primaryEntry.normalized.hash?.trim()
          ? {
              blockchain: {
                name: primaryEntry.normalized.network || 'unknown',
                transaction_hash: primaryEntry.normalized.hash.trim(),
                is_confirmed: primaryEntry.normalized.status === 'success',
              },
            }
          : {}),
      };

      transactions.push(processedTransaction);
      this.logger.debug(
        `Successfully processed correlated entry group ${processedTransaction.externalId} (${fundFlow.entryCount} entries)`
      );
    }

    const failedGroups = processingErrors.length;

    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for ${this.sourceName}:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.correlationId}] ${e.error} (${e.entryCount} entries)`)
          .join('\n')}`
      );

      return err(
        this.buildProcessingFailureError(
          failedGroups,
          entryGroups.size,
          processingErrors.map((e) => ({ id: e.correlationId, error: e.error }))
        )
      );
    }

    return okAsync(transactions);
  }

  /**
   * Analyze fund flow from a group of correlated ledger entries.
   * Uses interpretation strategy to extract amounts/fees from each entry.
   */
  protected analyzeFundFlow(entryGroup: LedgerEntryWithRaw<TRaw>[]): Result<ExchangeFundFlow, string> {
    if (entryGroup.length === 0) {
      return err('Empty entry group');
    }

    const allInflows: MovementInput[] = [];
    const allOutflows: MovementInput[] = [];
    const allFees: FeeInput[] = [];

    for (const entry of entryGroup) {
      // Interpretation strategy sees both raw and normalized, and returns Result
      const interpResult = this.interpretation.interpret(entry, entryGroup, this.sourceName);

      if (interpResult.isErr()) {
        return err(`Interpretation failed for entry ${entry.normalized.id}: ${interpResult.error.message}`);
      }

      const interp = interpResult.value;
      allInflows.push(...interp.inflows);
      allOutflows.push(...interp.outflows);
      allFees.push(...interp.fees);
    }

    // Consolidate duplicates (e.g., multiple BTC entries → sum them)
    const consolidatedInflows = consolidateExchangeMovements(allInflows);
    const consolidatedOutflows = consolidateExchangeMovements(allOutflows);
    const consolidatedFees = consolidateExchangeFees(allFees);

    // Select primary asset (largest inflow, or largest outflow if no inflows)
    const primary = selectPrimaryMovement(consolidatedInflows, consolidatedOutflows);

    const primaryEntry = entryGroup[0]!;
    const classificationUncertainty = detectExchangeClassificationUncertainty(
      consolidatedInflows,
      consolidatedOutflows
    );

    return ok({
      inflows: consolidatedInflows,
      outflows: consolidatedOutflows,
      fees: consolidatedFees,
      primary,
      correlationId: primaryEntry.normalized.correlationId,
      entryCount: entryGroup.length,
      timestamp: primaryEntry.normalized.timestamp,
      classificationUncertainty,
    });
  }

  /**
   * Determine operation type and category from fund flow analysis.
   * Can be overridden by subclasses for exchange-specific logic.
   */
  protected determineOperationFromFundFlow(
    fundFlow: ExchangeFundFlow,
    _entryGroup: LedgerEntryWithRaw<TRaw>[]
  ): OperationClassification {
    return classifyExchangeOperationFromFundFlow(fundFlow);
  }

  /**
   * Select the primary entry from a group to use as the representative transaction.
   * Can be overridden by subclasses if needed.
   */
  protected selectPrimaryEntry(
    entryGroup: LedgerEntryWithRaw<TRaw>[],
    _fundFlow: ExchangeFundFlow
  ): LedgerEntryWithRaw<TRaw> | undefined {
    return entryGroup[0];
  }
}
