import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, okAsync, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type {
  FeeInput,
  GroupingStrategy,
  InterpretationStrategy,
  MovementInput,
  RawTransactionWithMetadata,
} from './strategies/index.ts';
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
        id: 0, // Will be assigned by database
        externalId: primaryEntry.normalized.id,
        datetime: new Date(fundFlow.timestamp).toISOString(),
        timestamp: fundFlow.timestamp,
        source: this.sourceId,
        status: primaryEntry.normalized.status,

        movements: {
          inflows: fundFlow.inflows.map((inflow) => {
            const gross = parseDecimal(inflow.grossAmount ?? inflow.amount);
            const net = parseDecimal(inflow.netAmount ?? inflow.grossAmount ?? inflow.amount);

            return {
              asset: inflow.asset,
              grossAmount: gross,
              netAmount: net,
            };
          }),

          outflows: fundFlow.outflows.map((outflow) => {
            const gross = parseDecimal(outflow.grossAmount ?? outflow.amount);
            const net = parseDecimal(outflow.netAmount ?? outflow.grossAmount ?? outflow.amount);

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
  private consolidateMovements(movements: MovementInput[]): MovementInput[] {
    const assetMap = new Map<
      string,
      {
        amount: Decimal;
        grossAmount: Decimal;
        netAmount: Decimal;
      }
    >();

    for (const movement of movements) {
      const existing = assetMap.get(movement.asset);
      const amount = parseDecimal(movement.amount);
      const grossAmount = movement.grossAmount ? parseDecimal(movement.grossAmount) : amount;
      const netAmount = movement.netAmount ? parseDecimal(movement.netAmount) : grossAmount;

      if (existing) {
        assetMap.set(movement.asset, {
          amount: existing.amount.plus(amount),
          grossAmount: existing.grossAmount.plus(grossAmount),
          netAmount: existing.netAmount.plus(netAmount),
        });
      } else {
        assetMap.set(movement.asset, {
          amount,
          grossAmount,
          netAmount,
        });
      }
    }

    return Array.from(assetMap.entries()).map(([asset, amounts]) => ({
      asset,
      amount: amounts.amount.toFixed(),
      grossAmount: amounts.grossAmount.toFixed(),
      netAmount: amounts.netAmount?.toFixed(),
    }));
  }

  /**
   * Consolidate fees by asset, scope, and settlement.
   * Multiple fees with same dimensions are summed together.
   */
  private consolidateFees(fees: FeeInput[]): FeeInput[] {
    // Key format: `${asset}:${scope}:${settlement}`
    const feeMap = new Map<string, Omit<FeeInput, 'amount'> & { amount: Decimal }>();

    for (const fee of fees) {
      const key = `${fee.asset}:${fee.scope}:${fee.settlement}`;
      const existing = feeMap.get(key);

      if (existing) {
        feeMap.set(key, {
          ...existing,
          amount: existing.amount.plus(parseDecimal(fee.amount)),
        });
      } else {
        feeMap.set(key, {
          asset: fee.asset,
          amount: parseDecimal(fee.amount),
          scope: fee.scope,
          settlement: fee.settlement,
        });
      }
    }

    return Array.from(feeMap.values()).map((fee) => ({
      asset: fee.asset,
      amount: fee.amount.toFixed(),
      scope: fee.scope,
      settlement: fee.settlement,
    }));
  }
}
