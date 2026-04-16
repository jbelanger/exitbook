import type { AssetMovement, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';

import { buildAccountingLayerFromScopedBuild } from '../../../../../accounting-layer/build-accounting-layer-from-transactions.js';
import type {
  ValidatedTransferLink,
  ValidatedTransferSet,
} from '../../../../../accounting-layer/validated-transfer-links.js';
import type {
  AccountingLayerBuildResult,
  AccountingTransactionView,
  ResolvedInternalTransferCarryover,
} from '../../../../../cost-basis.js';
import type { UsdConversionRateProviderLike } from '../../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
  ScopedFeeMovement,
} from '../../../../standard/matching/build-cost-basis-scoped-transactions.js';
import {
  buildCanadaAccountingLayerContext,
  type CanadaAccountingLayerContext,
} from '../canada-accounting-layer-context.js';
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
    fees?: ScopedFeeMovement[] | undefined;
  }
): AccountingScopedTransaction {
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

  const fees: ScopedFeeMovement[] =
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

function buildStageAccountingLayer(params: {
  scopedTransactions: AccountingScopedTransaction[];
}): AccountingLayerBuildResult {
  return assertOk(
    buildAccountingLayerFromScopedBuild({
      inputTransactions: params.scopedTransactions.map((scopedTransaction) => scopedTransaction.tx),
      transactions: params.scopedTransactions,
      feeOnlyInternalCarryovers: [],
    })
  );
}

function buildStageCanadaAccountingContext(params: {
  feeOnlyInternalCarryovers?: FeeOnlyInternalCarryover[] | undefined;
  scopedTransactions: AccountingScopedTransaction[];
}): Result<CanadaAccountingLayerContext, Error> {
  const accountingLayer = buildStageAccountingLayer({ scopedTransactions: params.scopedTransactions });
  const baseContextResult = buildCanadaAccountingLayerContext(accountingLayer);
  if (baseContextResult.isErr()) {
    return err(baseContextResult.error);
  }

  const resolvedCarryoversResult = buildStageResolvedCarryovers(
    accountingLayer,
    params.scopedTransactions,
    params.feeOnlyInternalCarryovers ?? []
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
  scopedTransactions: AccountingScopedTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}) {
  const accountingLayer = buildStageAccountingLayer({ scopedTransactions: params.scopedTransactions });
  return projectCanadaMovementEventsImpl({
    accountingTransactionViews: accountingLayer.accountingTransactionViews,
    identityConfig: params.identityConfig,
    usdConversionRateProvider: params.usdConversionRateProvider,
    validatedTransfers: params.validatedTransfers,
  });
}

export async function applyCarryoverSemantics(params: {
  events: Parameters<typeof applyCarryoverSemanticsImpl>[0]['events'];
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
  identityConfig: typeof identityConfig;
  scopedTransactions: AccountingScopedTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    scopedTransactions: params.scopedTransactions,
    feeOnlyInternalCarryovers: params.feeOnlyInternalCarryovers,
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
  scopedTransactions: AccountingScopedTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    scopedTransactions: params.scopedTransactions,
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
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
  identityConfig: typeof identityConfig;
  scopedTransactions: AccountingScopedTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    scopedTransactions: params.scopedTransactions,
    feeOnlyInternalCarryovers: params.feeOnlyInternalCarryovers,
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
  feeOnlyInternalCarryovers?: FeeOnlyInternalCarryover[] | undefined;
  identityConfig: typeof identityConfig;
  sameAssetTransferFeeEvents: Parameters<typeof applyGenericFeeAdjustmentsImpl>[0]['sameAssetTransferFeeEvents'];
  scopedTransactions: AccountingScopedTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
}) {
  const canadaAccountingContextResult = buildStageCanadaAccountingContext({
    scopedTransactions: params.scopedTransactions,
    feeOnlyInternalCarryovers: params.feeOnlyInternalCarryovers,
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
  accountingLayer: AccountingLayerBuildResult,
  scopedTransactions: AccountingScopedTransaction[],
  feeOnlyInternalCarryovers: readonly FeeOnlyInternalCarryover[]
): Result<ResolvedInternalTransferCarryover[], Error> {
  const scopedTransactionsById = new Map(
    scopedTransactions.map((scopedTransaction) => [scopedTransaction.tx.id, scopedTransaction] as const)
  );
  const transactionViewsById = new Map(
    accountingLayer.accountingTransactionViews.map((transactionView) => [
      transactionView.processedTransaction.id,
      transactionView,
    ])
  );
  const resolvedCarryovers: ResolvedInternalTransferCarryover[] = [];

  for (const carryover of feeOnlyInternalCarryovers) {
    const sourceScopedTransaction = scopedTransactionsById.get(carryover.sourceTransactionId);
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
      const targetScopedTransaction = scopedTransactionsById.get(target.targetTransactionId);
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
