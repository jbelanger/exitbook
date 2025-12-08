import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { err, ok, okAsync, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.js';

import {
  classifyExchangeOperationFromFundFlow,
  consolidateExchangeFees,
  consolidateExchangeMovements,
  detectExchangeClassificationUncertainty,
  selectPrimaryMovement,
} from './correlating-exchange-processor-utils.js';
import type {
  FeeInput,
  GroupingStrategy,
  InterpretationStrategy,
  MovementInput,
  RawTransactionWithMetadata,
} from './strategies/index.js';
import type { ExchangeFundFlow } from './types.js';

/**
 * Base processor for exchange transactions using strategy composition.
 *
 * Provides infrastructure for:
 * - Grouping related ledger entries (e.g., both sides of a swap)
 * - Analyzing fund flow using interpretation strategies
 * - Creating single atomic UniversalTransaction records
 *
 * @template TRaw - The raw exchange-specific type (e.g., CoinbaseLedgerEntry, KrakenLedgerEntry)
 */
export class CorrelatingExchangeProcessor<TRaw = unknown> extends BaseTransactionProcessor {
  constructor(
    sourceName: string,
    private grouping: GroupingStrategy,
    private interpretation: InterpretationStrategy<TRaw>
  ) {
    super(sourceName);
  }

  protected async processInternal(normalizedData: unknown[]): Promise<Result<UniversalTransaction[], string>> {
    // Cast to RawTransactionWithMetadata (contains both raw + normalized)
    const entries = normalizedData as RawTransactionWithMetadata<TRaw>[];

    this.logger.info(`Processing ${entries.length} ledger entries for ${this.sourceName}`);

    // Group using strategy (e.g., by correlationId, timestamp, or no grouping)
    const entryGroups = this.grouping.group(entries);

    this.logger.debug(`Created ${entryGroups.size} entry groups for ${this.sourceName}`);

    const transactions: UniversalTransaction[] = [];
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
      const classification = classifyExchangeOperationFromFundFlow(fundFlow);
      const primaryEntry = this.selectPrimaryEntry(entryGroup, fundFlow);

      if (!primaryEntry) {
        const errorMsg = 'No primary entry found for correlated group';
        processingErrors.push({ correlationId, entryCount: entryGroup.length, error: errorMsg });
        this.logger.error(
          `${errorMsg} ${correlationId} (${entryGroup.length} entries) - THIS TRANSACTION GROUP WILL BE LOST. Group types: ${entryGroup.map((e) => e.normalized.type).join(', ')}`
        );
        continue;
      }

      const universalTransaction: UniversalTransaction = {
        externalId: primaryEntry.normalized.id,
        datetime: new Date(fundFlow.timestamp).toISOString(),
        timestamp: fundFlow.timestamp,
        source: this.sourceName,
        status: primaryEntry.normalized.status,

        movements: {
          inflows: fundFlow.inflows.map((inflow) => {
            const gross = parseDecimal(inflow.grossAmount);
            const net = parseDecimal(inflow.netAmount ?? inflow.grossAmount);

            return {
              asset: inflow.asset,
              grossAmount: gross,
              netAmount: net,
            };
          }),

          outflows: fundFlow.outflows.map((outflow) => {
            const gross = parseDecimal(outflow.grossAmount);
            const net = parseDecimal(outflow.netAmount ?? outflow.grossAmount);

            return {
              asset: outflow.asset,
              grossAmount: gross,
              netAmount: net,
            };
          }),
        },

        fees: fundFlow.fees.map((fee) => ({
          asset: fee.asset,
          amount: parseDecimal(fee.amount),
          scope: fee.scope,
          settlement: fee.settlement,
        })),

        operation: classification.operation,
        note: classification.note,

        metadata: {
          correlatedEntryCount: fundFlow.entryCount,
          correlationId: fundFlow.correlationId,
          ledgerEntries: entryGroup.map((e) => e.normalized.id),
        },
      };

      transactions.push(universalTransaction);
      this.logger.debug(
        `Successfully processed correlated entry group ${universalTransaction.externalId} (${fundFlow.entryCount} entries)`
      );
    }

    const totalInputEntries = normalizedData.length;
    const successfulGroups = transactions.length;
    const failedGroups = processingErrors.length;
    const lostEntryCount = processingErrors.reduce((sum, e) => sum + e.entryCount, 0);

    this.logger.info(
      `Processing completed for ${this.sourceName}: ${successfulGroups} groups processed, ${failedGroups} groups failed (${lostEntryCount}/${totalInputEntries} entries lost)`
    );

    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for ${this.sourceName}:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.correlationId}] ${e.error} (${e.entryCount} entries)`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedGroups}/${entryGroups.size} entry groups failed to process. ` +
          `Lost ${lostEntryCount} entries which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.correlationId}]: ${e.error}`).join('; ')}`
      );
    }

    return okAsync(transactions);
  }

  /**
   * Analyze fund flow from a group of correlated ledger entries.
   * Uses interpretation strategy to extract amounts/fees from each entry.
   */
  protected analyzeFundFlow(entryGroup: RawTransactionWithMetadata<TRaw>[]): Result<ExchangeFundFlow, string> {
    if (entryGroup.length === 0) {
      return err('Empty entry group');
    }

    const allInflows: MovementInput[] = [];
    const allOutflows: MovementInput[] = [];
    const allFees: FeeInput[] = [];

    for (const entry of entryGroup) {
      // Interpretation strategy sees both raw and normalized
      const interp = this.interpretation.interpret(entry, entryGroup);

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
  protected determineOperationFromFundFlow(fundFlow: ExchangeFundFlow): {
    note?:
      | { message: string; metadata?: Record<string, unknown> | undefined; severity: 'info' | 'warning'; type: string }
      | undefined;
    operation: {
      category: 'trade' | 'transfer' | 'fee' | 'staking';
      type: 'swap' | 'deposit' | 'withdrawal' | 'transfer' | 'fee' | 'refund' | 'reward';
    };
  } {
    return classifyExchangeOperationFromFundFlow(fundFlow);
  }

  /**
   * Select the primary entry from a group to use as the representative transaction.
   * Can be overridden by subclasses if needed.
   */
  protected selectPrimaryEntry(
    entryGroup: RawTransactionWithMetadata<TRaw>[],
    _fundFlow: ExchangeFundFlow
  ): RawTransactionWithMetadata<TRaw> | undefined {
    return entryGroup[0];
  }
}
