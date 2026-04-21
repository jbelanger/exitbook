import type { AssetMovement, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';

import type {
  AccountingModelBuildResult,
  AccountingTransactionView,
  ResolvedInternalTransferCarryover,
} from '../../../../../accounting-model.js';
import { buildAccountingModelFromPreparedBuild } from '../../../../../accounting-model/build-accounting-model-from-transactions.js';
import type {
  PreparedAccountingTransaction,
  InternalTransferCarryoverDraft,
  PreparedFeeMovement,
} from '../../../../../accounting-model/prepare-accounting-transactions.js';
import type {
  ValidatedTransferLink,
  ValidatedTransferSet,
} from '../../../../../accounting-model/validated-transfer-links.js';
import type { UsdConversionRateProviderLike } from '../../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import {
  buildCanadaAccountingModelContext,
  type CanadaAccountingModelContext,
} from '../canada-accounting-model-context.js';
import { applyCarryoverSemantics as applyCarryoverSemanticsImpl } from '../canada-tax-event-carryover.js';
import {
  applyGenericFeeAdjustments as applyGenericFeeAdjustmentsImpl,
  buildSameAssetTransferFeeAdjustments as buildSameAssetTransferFeeAdjustmentsImpl,
  buildValidatedTransferTargetFeeAdjustments as buildValidatedTransferTargetFeeAdjustmentsImpl,
} from '../canada-tax-event-fee-adjustments.js';
import { projectCanadaMovementEvents as projectCanadaMovementEventsImpl } from '../canada-tax-event-projection.js';

export const identityConfig = {};

export function createFxProvider(fromUSD?: Record<string, string>): UsdConversionRateProviderLike {
  return {
    getRateToUSD: async () => err(new Error('not implemented')),
    getRateFromUSD: async (currency: Currency) => {
      const rate = fromUSD?.[currency];
      if (!rate) return err(new Error(`No fromUSD rate for ${currency}`));
      return ok({ rate: parseDecimal(rate), source: 'test', fetchedAt: new Date() });
    },
  };
}

function patchAssetId(assetId: string): string {
  if (assetId.startsWith('test:')) {
    return `exchange:test:${assetId.slice(5)}`;
  }

  return assetId;
}

export function buildScopedTransaction(
  tx: Transaction,
  options?: {
    fees?: PreparedFeeMovement[] | undefined;
  }
): PreparedAccountingTransaction {
  const inflows: AssetMovement[] = (tx.movements.inflows ?? []).map((movement) => ({
    ...movement,
    assetId: patchAssetId(movement.assetId),
    movementFingerprint: movement.movementFingerprint,
  }));

  const outflows: AssetMovement[] = (tx.movements.outflows ?? []).map((movement) => ({
    ...movement,
    assetId: patchAssetId(movement.assetId),
    movementFingerprint: movement.movementFingerprint,
  }));

  const fees: PreparedFeeMovement[] =
    options?.fees ??
    tx.fees.map((fee) => ({
      ...fee,
      assetId: patchAssetId(fee.assetId),
      originalTransactionId: tx.id,
    }));

  return {
    tx,
    rebuildDependencyTransactionIds: [],
    movements: { inflows, outflows },
    fees,
  };
}

export function emptyTransferSet(): ValidatedTransferSet {
  return {
    links: [],
    bySourceMovementFingerprint: new Map(),
    byTargetMovementFingerprint: new Map(),
  };
}

export function makeTransferSet(links: ValidatedTransferLink[]): ValidatedTransferSet {
  const bySource = new Map<string, ValidatedTransferLink[]>();
  const byTarget = new Map<string, ValidatedTransferLink[]>();

  for (const link of links) {
    const sourceList = bySource.get(link.sourceMovementFingerprint) ?? [];
    sourceList.push(link);
    bySource.set(link.sourceMovementFingerprint, sourceList);

    const targetList = byTarget.get(link.targetMovementFingerprint) ?? [];
    targetList.push(link);
    byTarget.set(link.targetMovementFingerprint, targetList);
  }

  return { links, bySourceMovementFingerprint: bySource, byTargetMovementFingerprint: byTarget };
}

function buildStageAccountingModel(params: {
  preparedTransactions: PreparedAccountingTransaction[];
}): AccountingModelBuildResult {
  return assertOk(
    buildAccountingModelFromPreparedBuild({
      inputTransactions: params.preparedTransactions.map((preparedTransaction) => preparedTransaction.tx),
      transactions: params.preparedTransactions,
      internalTransferCarryoverDrafts: [],
    })
  );
}

function buildStageCanadaAccountingContext(params: {
  internalTransferCarryoverDrafts?: InternalTransferCarryoverDraft[] | undefined;
  preparedTransactions: PreparedAccountingTransaction[];
}): Result<CanadaAccountingModelContext, Error> {
  const accountingModel = buildStageAccountingModel({ preparedTransactions: params.preparedTransactions });
  const baseContextResult = buildCanadaAccountingModelContext(accountingModel);
  if (baseContextResult.isErr()) {
    return err(baseContextResult.error);
  }

  const resolvedCarryoversResult = buildStageResolvedCarryovers(
    accountingModel,
    params.preparedTransactions,
    params.internalTransferCarryoverDrafts ?? []
  );
  if (resolvedCarryoversResult.isErr()) {
    return err(resolvedCarryoversResult.error);
  }

  return ok({
    ...baseContextResult.value,
    resolvedInternalTransferCarryovers: resolvedCarryoversResult.value,
  });
}

export async function projectCanadaMovementEvents(params: {
  identityConfig: typeof identityConfig;
  preparedTransactions: PreparedAccountingTransaction[];
  transactionAnnotations?: readonly TransactionAnnotation[] | undefined;
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}) {
  const accountingModel = buildStageAccountingModel({ preparedTransactions: params.preparedTransactions });
  return projectCanadaMovementEventsImpl({
    accountingTransactionViews: accountingModel.accountingTransactionViews,
    identityConfig: params.identityConfig,
    transactionAnnotations: params.transactionAnnotations,
    usdConversionRateProvider: params.usdConversionRateProvider,
    validatedTransfers: params.validatedTransfers,
  });
}

export async function applyCarryoverSemantics(params: {
  events: Parameters<typeof applyCarryoverSemanticsImpl>[0]['events'];
  identityConfig: typeof identityConfig;
  internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[];
  preparedTransactions: PreparedAccountingTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    preparedTransactions: params.preparedTransactions,
    internalTransferCarryoverDrafts: params.internalTransferCarryoverDrafts,
  });
  if (canadaAccountingContextResult.isErr()) {
    return err(canadaAccountingContextResult.error);
  }

  return applyCarryoverSemanticsImpl({
    canadaAccountingContext: canadaAccountingContextResult.value,
    events: params.events,
    identityConfig: params.identityConfig,
    usdConversionRateProvider: params.usdConversionRateProvider,
  });
}

export async function buildValidatedTransferTargetFeeAdjustments(params: {
  identityConfig: typeof identityConfig;
  preparedTransactions: PreparedAccountingTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    preparedTransactions: params.preparedTransactions,
  });
  if (canadaAccountingContextResult.isErr()) {
    return err(canadaAccountingContextResult.error);
  }

  return buildValidatedTransferTargetFeeAdjustmentsImpl({
    canadaAccountingContext: canadaAccountingContextResult.value,
    identityConfig: params.identityConfig,
    usdConversionRateProvider: params.usdConversionRateProvider,
    validatedTransfers: params.validatedTransfers,
  });
}

export async function buildSameAssetTransferFeeAdjustments(params: {
  identityConfig: typeof identityConfig;
  internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[];
  preparedTransactions: PreparedAccountingTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    preparedTransactions: params.preparedTransactions,
    internalTransferCarryoverDrafts: params.internalTransferCarryoverDrafts,
  });
  if (canadaAccountingContextResult.isErr()) {
    return err(canadaAccountingContextResult.error);
  }

  return buildSameAssetTransferFeeAdjustmentsImpl({
    canadaAccountingContext: canadaAccountingContextResult.value,
    identityConfig: params.identityConfig,
    usdConversionRateProvider: params.usdConversionRateProvider,
    validatedTransfers: params.validatedTransfers,
  });
}

export async function applyGenericFeeAdjustments(params: {
  events: Parameters<typeof applyGenericFeeAdjustmentsImpl>[0]['events'];
  identityConfig: typeof identityConfig;
  internalTransferCarryoverDrafts?: InternalTransferCarryoverDraft[] | undefined;
  preparedTransactions: PreparedAccountingTransaction[];
  sameAssetTransferFeeEvents: Parameters<typeof applyGenericFeeAdjustmentsImpl>[0]['sameAssetTransferFeeEvents'];
  usdConversionRateProvider: UsdConversionRateProviderLike;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    preparedTransactions: params.preparedTransactions,
    internalTransferCarryoverDrafts: params.internalTransferCarryoverDrafts,
  });
  if (canadaAccountingContextResult.isErr()) {
    return err(canadaAccountingContextResult.error);
  }

  return applyGenericFeeAdjustmentsImpl({
    canadaAccountingContext: canadaAccountingContextResult.value,
    events: params.events,
    identityConfig: params.identityConfig,
    sameAssetTransferFeeEvents: params.sameAssetTransferFeeEvents,
    usdConversionRateProvider: params.usdConversionRateProvider,
  });
}

function buildStageResolvedCarryovers(
  accountingModel: AccountingModelBuildResult,
  preparedTransactions: PreparedAccountingTransaction[],
  internalTransferCarryoverDrafts: readonly InternalTransferCarryoverDraft[]
): Result<ResolvedInternalTransferCarryover[], Error> {
  const preparedTransactionsById = new Map(
    preparedTransactions.map((preparedTransaction) => [preparedTransaction.tx.id, preparedTransaction] as const)
  );
  const transactionViewsById = new Map(
    accountingModel.accountingTransactionViews.map((transactionView) => [
      transactionView.processedTransaction.id,
      transactionView,
    ])
  );
  const resolvedCarryovers: ResolvedInternalTransferCarryover[] = [];

  for (const carryover of internalTransferCarryoverDrafts) {
    const sourceScopedTransaction = preparedTransactionsById.get(carryover.sourceTransactionId);
    if (!sourceScopedTransaction) {
      return err(new Error(`Carryover source transaction ${carryover.sourceTransactionId} not found`));
    }

    const sourceTransactionView = transactionViewsById.get(carryover.sourceTransactionId);
    const sourceMovement = sourceScopedTransaction.movements.outflows.find(
      (movement) => movement.movementFingerprint === carryover.sourceMovementFingerprint
    ) ??
      sourceScopedTransaction.movements.outflows[0] ?? {
        assetId: carryover.assetId,
        assetSymbol: carryover.assetSymbol,
        grossAmount: carryover.retainedQuantity,
        movementFingerprint: carryover.sourceMovementFingerprint,
        netAmount: carryover.retainedQuantity,
        movementRole: 'principal',
        priceAtTxTime: carryover.fee.priceAtTxTime,
      };

    const targets = carryover.targets.map((target, index) => {
      const targetScopedTransaction = preparedTransactionsById.get(target.targetTransactionId);
      const targetTransactionView = transactionViewsById.get(target.targetTransactionId);
      const targetMovement = targetScopedTransaction?.movements.inflows.find(
        (movement) => movement.movementFingerprint === target.targetMovementFingerprint
      ) ??
        targetScopedTransaction?.movements.outflows.find(
          (movement) => movement.movementFingerprint === target.targetMovementFingerprint
        ) ?? {
          assetId: carryover.assetId,
          assetSymbol: carryover.assetSymbol,
          grossAmount: target.quantity,
          movementFingerprint: target.targetMovementFingerprint,
          netAmount: target.quantity,
          movementRole: 'principal',
          priceAtTxTime: undefined,
        };

      const targetProcessedTransaction = targetScopedTransaction?.tx ?? sourceScopedTransaction.tx;
      const targetEntryFingerprint = `stage:carryover:${carryover.sourceTransactionId}:target:${index}`;
      const targetSourceKind: 'accounting_transaction_view' | 'processed_transaction' = targetTransactionView
        ? 'accounting_transaction_view'
        : 'processed_transaction';

      return {
        binding: {
          quantity: target.quantity,
          targetEntryFingerprint,
        },
        target: {
          entry: {
            entryFingerprint: targetEntryFingerprint,
            kind: 'asset_inflow' as const,
            assetId: targetMovement.assetId,
            assetSymbol: targetMovement.assetSymbol,
            quantity: target.quantity,
            role: targetMovement.movementRole ?? 'principal',
            provenanceBindings: [
              {
                txFingerprint: targetProcessedTransaction.txFingerprint,
                movementFingerprint: target.targetMovementFingerprint,
                quantity: target.quantity,
              },
            ],
          },
          movement: {
            assetId: targetMovement.assetId,
            assetSymbol: targetMovement.assetSymbol,
            grossQuantity: targetMovement.grossAmount,
            movementFingerprint: target.targetMovementFingerprint,
            netQuantity: targetMovement.netAmount,
            priceAtTxTime: targetMovement.priceAtTxTime,
            role: targetMovement.movementRole ?? 'principal',
            sourceKind: targetSourceKind,
          },
          processedTransaction: targetProcessedTransaction,
          provenanceBinding: {
            txFingerprint: targetProcessedTransaction.txFingerprint,
            movementFingerprint: target.targetMovementFingerprint,
            quantity: target.quantity,
          },
          transactionView: targetTransactionView ?? buildSyntheticTransactionView(targetProcessedTransaction),
        },
      };
    });

    const sourceEntryFingerprint = `stage:carryover:${carryover.sourceTransactionId}:source`;
    const feeEntryFingerprint = `stage:carryover:${carryover.sourceTransactionId}:fee`;
    const sourceKind: 'accounting_transaction_view' | 'processed_transaction' = sourceTransactionView
      ? 'accounting_transaction_view'
      : 'processed_transaction';

    resolvedCarryovers.push({
      carryover: {
        sourceEntryFingerprint,
        targetBindings: targets.map((target) => target.binding),
        feeEntryFingerprint,
      },
      fee: {
        entry: {
          entryFingerprint: feeEntryFingerprint,
          kind: 'fee' as const,
          assetId: carryover.fee.assetId,
          assetSymbol: carryover.fee.assetSymbol,
          quantity: carryover.fee.amount,
          feeScope: carryover.fee.scope,
          feeSettlement: carryover.fee.settlement,
          provenanceBindings: [
            {
              txFingerprint: sourceScopedTransaction.tx.txFingerprint,
              movementFingerprint: carryover.fee.movementFingerprint,
              quantity: carryover.fee.amount,
            },
          ],
        },
        fee: {
          assetId: carryover.fee.assetId,
          assetSymbol: carryover.fee.assetSymbol,
          entryFingerprint: feeEntryFingerprint,
          feeScope: carryover.fee.scope,
          feeSettlement: carryover.fee.settlement,
          movementFingerprint: carryover.fee.movementFingerprint,
          priceAtTxTime: carryover.fee.priceAtTxTime,
          quantity: carryover.fee.amount,
        },
        provenanceBinding: {
          txFingerprint: sourceScopedTransaction.tx.txFingerprint,
          movementFingerprint: carryover.fee.movementFingerprint,
          quantity: carryover.fee.amount,
        },
        transactionView: sourceTransactionView ?? buildSyntheticTransactionView(sourceScopedTransaction.tx),
      },
      source: {
        entry: {
          entryFingerprint: sourceEntryFingerprint,
          kind: 'asset_outflow' as const,
          assetId: sourceMovement.assetId,
          assetSymbol: sourceMovement.assetSymbol,
          quantity: carryover.retainedQuantity,
          role: sourceMovement.movementRole ?? 'principal',
          provenanceBindings: [
            {
              txFingerprint: sourceScopedTransaction.tx.txFingerprint,
              movementFingerprint: carryover.sourceMovementFingerprint,
              quantity: carryover.retainedQuantity,
            },
          ],
        },
        movement: {
          assetId: sourceMovement.assetId,
          assetSymbol: sourceMovement.assetSymbol,
          grossQuantity: sourceMovement.grossAmount,
          movementFingerprint: carryover.sourceMovementFingerprint,
          netQuantity: sourceMovement.netAmount,
          priceAtTxTime: sourceMovement.priceAtTxTime,
          role: sourceMovement.movementRole ?? 'principal',
          sourceKind,
        },
        processedTransaction: sourceScopedTransaction.tx,
        provenanceBinding: {
          txFingerprint: sourceScopedTransaction.tx.txFingerprint,
          movementFingerprint: carryover.sourceMovementFingerprint,
          quantity: carryover.retainedQuantity,
        },
        transactionView: sourceTransactionView,
      },
      targets,
    });
  }

  return ok(resolvedCarryovers);
}

function buildSyntheticTransactionView(processedTransaction: Transaction): AccountingTransactionView {
  return {
    fees: [],
    inflows: [],
    outflows: [],
    processedTransaction,
  };
}
