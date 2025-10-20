import type { UniversalTransaction } from '@exitbook/core';
import { createMoney, parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { GroupingStrategy, InterpretationStrategy, RawTransactionWithMetadata } from './strategies/index.ts';
import type { ExchangeFundFlow } from './types.ts';

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
    sourceId: string,
    private grouping: GroupingStrategy,
    private interpretation: InterpretationStrategy<TRaw>
  ) {
    super(sourceId);
  }

  protected async processInternal(
    normalizedData: unknown[],
    _sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    // Cast to RawTransactionWithMetadata (contains both raw + normalized)
    const entries = normalizedData as RawTransactionWithMetadata<TRaw>[];

    this.logger.info(`Processing ${entries.length} ledger entries for ${this.sourceId}`);

    // Group using strategy (e.g., by correlationId, timestamp, or no grouping)
    const entryGroups = this.grouping.group(entries);

    this.logger.debug(`Created ${entryGroups.size} entry groups for ${this.sourceId}`);

    const transactions: UniversalTransaction[] = [];
    const processingErrors: { correlationId: string; entryCount: number; error: string }[] = [];

    for (const [correlationId, entryGroup] of entryGroups) {
      const fundFlowResult = this.analyzeFundFlow(entryGroup);

      if (fundFlowResult.isErr()) {
        const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
        processingErrors.push({ correlationId, entryCount: entryGroup.length, error: errorMsg });
        this.logger.error(
          `${errorMsg} for ${this.sourceId} entry group ${correlationId} (${entryGroup.length} entries) - THIS TRANSACTION GROUP WILL BE LOST`
        );
        continue;
      }

      const fundFlow = fundFlowResult.value;
      const classification = this.determineOperationFromFundFlow(fundFlow);
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
        id: primaryEntry.normalized.id,
        datetime: new Date(fundFlow.timestamp).toISOString(),
        timestamp: fundFlow.timestamp,
        source: this.sourceId,
        status: primaryEntry.normalized.status,

        movements: {
          inflows: fundFlow.inflows.map((inflow) => ({
            amount: parseDecimal(inflow.amount),
            asset: inflow.asset,
          })),
          outflows: fundFlow.outflows.map((outflow) => ({
            amount: parseDecimal(outflow.amount),
            asset: outflow.asset,
          })),
          primary: {
            amount: parseDecimal(fundFlow.primary.amount),
            asset: fundFlow.primary.asset,
            direction: this.determinePrimaryDirection(fundFlow),
          },
        },

        fees: {
          network: undefined,
          platform:
            fundFlow.fees.length > 0
              ? createMoney(fundFlow.fees[0]!.amount, fundFlow.fees[0]!.currency)
              : createMoney('0', fundFlow.primary.asset),
          total:
            fundFlow.fees.length > 0
              ? createMoney(fundFlow.fees[0]!.amount, fundFlow.fees[0]!.currency)
              : createMoney('0', fundFlow.primary.asset),
        },

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
        `Successfully processed correlated entry group ${universalTransaction.id} (${fundFlow.entryCount} entries)`
      );
    }

    const totalInputEntries = normalizedData.length;
    const successfulGroups = transactions.length;
    const failedGroups = processingErrors.length;
    const lostEntryCount = processingErrors.reduce((sum, e) => sum + e.entryCount, 0);

    this.logger.info(
      `Processing completed for ${this.sourceId}: ${successfulGroups} groups processed, ${failedGroups} groups failed (${lostEntryCount}/${totalInputEntries} entries lost)`
    );

    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for ${this.sourceId}:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.correlationId}] ${e.error} (${e.entryCount} entries)`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedGroups}/${entryGroups.size} entry groups failed to process. ` +
          `Lost ${lostEntryCount} entries which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.correlationId}]: ${e.error}`).join('; ')}`
      );
    }

    return Promise.resolve(ok(transactions));
  }

  /**
   * Analyze fund flow from a group of correlated ledger entries.
   * Uses interpretation strategy to extract amounts/fees from each entry.
   */
  protected analyzeFundFlow(entryGroup: RawTransactionWithMetadata<TRaw>[]): Result<ExchangeFundFlow, string> {
    if (entryGroup.length === 0) {
      return err('Empty entry group');
    }

    const allInflows: { amount: string; asset: string }[] = [];
    const allOutflows: { amount: string; asset: string }[] = [];
    const allFees: { amount: string; currency: string }[] = [];

    for (const entry of entryGroup) {
      // Interpretation strategy sees both raw and normalized
      const interp = this.interpretation.interpret(entry, entryGroup);

      allInflows.push(...interp.inflows);
      allOutflows.push(...interp.outflows);
      allFees.push(...interp.fees);
    }

    // Consolidate duplicates (e.g., multiple BTC entries → sum them)
    const consolidatedInflows = this.consolidateMovements(allInflows);
    const consolidatedOutflows = this.consolidateMovements(allOutflows);
    const consolidatedFees = this.consolidateFees(allFees);

    // Select primary asset (largest inflow, or largest outflow if no inflows)
    const primary = this.selectPrimaryMovement(consolidatedInflows, consolidatedOutflows);

    const primaryEntry = entryGroup[0]!;
    const classificationUncertainty = this.detectClassificationUncertainty(consolidatedInflows, consolidatedOutflows);

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
    const { inflows, outflows } = fundFlow;

    // Pattern 1: Single asset swap
    if (outflows.length === 1 && inflows.length === 1) {
      const outAsset = outflows[0]?.asset;
      const inAsset = inflows[0]?.asset;

      if (outAsset !== inAsset) {
        return {
          operation: {
            category: 'trade',
            type: 'swap',
          },
        };
      }
    }

    // Pattern 2: Simple deposit
    if (outflows.length === 0 && inflows.length >= 1) {
      return {
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };
    }

    // Pattern 3: Simple withdrawal
    if (outflows.length >= 1 && inflows.length === 0) {
      return {
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
      };
    }

    // Pattern 4: Self-transfer (same asset in and out)
    if (outflows.length === 1 && inflows.length === 1) {
      const outAsset = outflows[0]?.asset;
      const inAsset = inflows[0]?.asset;

      if (outAsset === inAsset) {
        return {
          operation: {
            category: 'transfer',
            type: 'transfer',
          },
        };
      }
    }

    // Pattern 5: Fee-only entry
    if (inflows.length === 0 && outflows.length === 0 && fundFlow.fees.length > 0) {
      return {
        operation: {
          category: 'fee',
          type: 'fee',
        },
      };
    }

    // Pattern 6: Complex multi-asset transaction
    if (fundFlow.classificationUncertainty) {
      return {
        note: {
          message: fundFlow.classificationUncertainty,
          metadata: {
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'classification_uncertain',
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }

    return {
      note: {
        message: 'Unable to determine transaction classification using confident patterns.',
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'warning',
        type: 'classification_failed',
      },
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
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

  /**
   * Select primary movement (largest inflow, or largest outflow if no inflows).
   */
  private selectPrimaryMovement(
    consolidatedInflows: { amount: string; asset: string }[],
    consolidatedOutflows: { amount: string; asset: string }[]
  ): { amount: string; asset: string } {
    let primary = {
      amount: '0',
      asset: consolidatedInflows[0]?.asset || consolidatedOutflows[0]?.asset || 'UNKNOWN',
    };

    const largestInflow = consolidatedInflows
      .sort((a, b) => {
        try {
          return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
        } catch {
          return 0;
        }
      })
      .find((inflow) => !parseDecimal(inflow.amount).isZero());

    if (largestInflow) {
      primary = {
        amount: largestInflow.amount,
        asset: largestInflow.asset,
      };
    } else {
      const largestOutflow = consolidatedOutflows
        .sort((a, b) => {
          try {
            return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
          } catch {
            return 0;
          }
        })
        .find((outflow) => !parseDecimal(outflow.amount).isZero());

      if (largestOutflow) {
        primary = {
          amount: largestOutflow.amount,
          asset: largestOutflow.asset,
        };
      }
    }

    return primary;
  }

  /**
   * Detect if classification may be uncertain due to complex fund flow.
   */
  private detectClassificationUncertainty(
    consolidatedInflows: { amount: string; asset: string }[],
    consolidatedOutflows: { amount: string; asset: string }[]
  ): string | undefined {
    if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
      return `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be multi-asset swap or batch operation.`;
    }
    return undefined;
  }

  /**
   * Determine primary direction based on fund flow.
   */
  private determinePrimaryDirection(fundFlow: ExchangeFundFlow): 'in' | 'out' | 'neutral' {
    const hasInflow = fundFlow.inflows.some((i) => i.asset === fundFlow.primary.asset);
    const hasOutflow = fundFlow.outflows.some((o) => o.asset === fundFlow.primary.asset);

    if (hasInflow && hasOutflow) return 'neutral';
    if (hasInflow) return 'in';
    if (hasOutflow) return 'out';
    return 'neutral';
  }

  /**
   * Consolidate duplicate assets by summing amounts.
   */
  private consolidateMovements(movements: { amount: string; asset: string }[]): { amount: string; asset: string }[] {
    const assetMap = new Map<string, Decimal>();

    for (const movement of movements) {
      const existing = assetMap.get(movement.asset);
      if (existing) {
        assetMap.set(movement.asset, existing.plus(parseDecimal(movement.amount)));
      } else {
        assetMap.set(movement.asset, parseDecimal(movement.amount));
      }
    }

    return Array.from(assetMap.entries()).map(([asset, amount]) => ({
      amount: amount.toString(),
      asset,
    }));
  }

  /**
   * Consolidate fees by currency.
   */
  private consolidateFees(fees: { amount: string; currency: string }[]): { amount: string; currency: string }[] {
    const feeMap = new Map<string, Decimal>();

    for (const fee of fees) {
      const existing = feeMap.get(fee.currency);
      if (existing) {
        feeMap.set(fee.currency, existing.plus(parseDecimal(fee.amount)));
      } else {
        feeMap.set(fee.currency, parseDecimal(fee.amount));
      }
    }

    return Array.from(feeMap.entries()).map(([currency, amount]) => ({
      amount: amount.toString(),
      currency,
    }));
  }
}
