import type { AssetMovementDraft, FeeMovementDraft } from '@exitbook/core';
import { err, isFiat, ok, type Result } from '@exitbook/foundation';

import type {
  AccountingFeeEntryView,
  AccountingLayerIndexes,
  AccountingTransactionView,
} from '../../../../cost-basis.js';
import { resolveTaxAssetIdentity } from '../../../model/tax-asset-identity.js';

import type { CanadaValuedFee } from './canada-tax-fee-utils.js';
import { buildCanadaTaxPropertyKey } from './canada-tax-identity-utils.js';
import type {
  CanadaAcquisitionEvent,
  CanadaDispositionEvent,
  CanadaFeeAdjustmentEvent,
  CanadaTaxInputContextBuildOptions,
  CanadaTaxInputEvent,
  CanadaTransferInEvent,
  CanadaTransferOutEvent,
} from './canada-tax-types.js';

export type CanadaMovementEvent =
  | CanadaAcquisitionEvent
  | CanadaDispositionEvent
  | CanadaTransferInEvent
  | CanadaTransferOutEvent;

interface CanadaPoolIdentity {
  assetIdentityKey: string;
  taxPropertyKey: string;
}

export interface CanadaEventIndex {
  byMovementFingerprint: Map<string, CanadaTaxInputEvent[]>;
  byTransactionId: Map<number, CanadaTaxInputEvent[]>;
}

export interface CanadaMovementIndexes {
  inflowsByFingerprint: Map<string, { movement: CanadaIndexedMovementRef; transactionView: AccountingTransactionView }>;
  outflowsByFingerprint: Map<
    string,
    { movement: CanadaIndexedMovementRef; transactionView: AccountingTransactionView }
  >;
  transactionViewsById: Map<number, AccountingTransactionView>;
}

export interface CanadaIndexedMovementRef {
  assetId: string;
  assetSymbol: AccountingTransactionView['inflows'][number]['assetSymbol'];
  grossQuantity: AccountingTransactionView['inflows'][number]['grossQuantity'];
  movementFingerprint: string;
  netQuantity?: AccountingTransactionView['inflows'][number]['netQuantity'];
  priceAtTxTime?: AccountingTransactionView['inflows'][number]['priceAtTxTime'];
  role: AccountingTransactionView['inflows'][number]['role'];
}

export function resolvePoolIdentity(
  item: Pick<AssetMovementDraft | FeeMovementDraft, 'assetId' | 'assetSymbol'>,
  identityConfig: CanadaTaxInputContextBuildOptions
): Result<CanadaPoolIdentity, Error> {
  if (isFiat(item.assetSymbol)) {
    return err(new Error(`Canada pool identity requires a non-fiat asset, received ${item.assetSymbol}`));
  }

  const assetIdentityResult = resolveTaxAssetIdentity(
    {
      assetId: item.assetId,
      assetSymbol: item.assetSymbol,
    },
    { assetIdentityOverridesByAssetId: identityConfig.assetIdentityOverridesByAssetId }
  );
  if (assetIdentityResult.isErr()) {
    return err(
      new Error(
        `Failed to resolve Canada pool identity for ${item.assetSymbol} (${item.assetId}): ` +
          assetIdentityResult.error.message
      )
    );
  }

  const taxPropertyKeyResult = buildCanadaTaxPropertyKey(assetIdentityResult.value.identityKey);
  if (taxPropertyKeyResult.isErr()) {
    return err(taxPropertyKeyResult.error);
  }

  return ok({
    assetIdentityKey: assetIdentityResult.value.identityKey,
    taxPropertyKey: taxPropertyKeyResult.value,
  });
}

export function buildEventIndex(events: CanadaTaxInputEvent[]): CanadaEventIndex {
  const byMovementFingerprint = new Map<string, CanadaTaxInputEvent[]>();
  const byTransactionId = new Map<number, CanadaTaxInputEvent[]>();

  for (const event of events) {
    const existingByTx = byTransactionId.get(event.transactionId) ?? [];
    existingByTx.push(event);
    byTransactionId.set(event.transactionId, existingByTx);

    const movementFingerprint = event.movementFingerprint;
    if (!movementFingerprint) {
      continue;
    }

    const existingByMovement = byMovementFingerprint.get(movementFingerprint) ?? [];
    existingByMovement.push(event);
    byMovementFingerprint.set(movementFingerprint, existingByMovement);
  }

  return { byMovementFingerprint, byTransactionId };
}

export function buildMovementIndexes(indexes: AccountingLayerIndexes): CanadaMovementIndexes {
  const inflowsByFingerprint = new Map<
    string,
    { movement: CanadaIndexedMovementRef; transactionView: AccountingTransactionView }
  >();
  const outflowsByFingerprint = new Map<
    string,
    { movement: CanadaIndexedMovementRef; transactionView: AccountingTransactionView }
  >();

  for (const [movementFingerprint, ref] of indexes.inflowRefsByMovementFingerprint.entries()) {
    if (!ref.transactionView) {
      continue;
    }

    inflowsByFingerprint.set(movementFingerprint, {
      movement: {
        assetId: ref.movement.assetId,
        assetSymbol: ref.movement.assetSymbol,
        grossQuantity: ref.movement.grossQuantity,
        movementFingerprint: ref.movement.movementFingerprint,
        netQuantity: ref.movement.netQuantity,
        priceAtTxTime: ref.movement.priceAtTxTime,
        role: ref.movement.role,
      },
      transactionView: ref.transactionView,
    });
  }

  for (const [movementFingerprint, ref] of indexes.outflowRefsByMovementFingerprint.entries()) {
    if (!ref.transactionView) {
      continue;
    }

    outflowsByFingerprint.set(movementFingerprint, {
      movement: {
        assetId: ref.movement.assetId,
        assetSymbol: ref.movement.assetSymbol,
        grossQuantity: ref.movement.grossQuantity,
        movementFingerprint: ref.movement.movementFingerprint,
        netQuantity: ref.movement.netQuantity,
        priceAtTxTime: ref.movement.priceAtTxTime,
        role: ref.movement.role,
      },
      transactionView: ref.transactionView,
    });
  }

  return {
    inflowsByFingerprint,
    outflowsByFingerprint,
    transactionViewsById: indexes.transactionViewsByTransactionId,
  };
}

export function buildAddToPoolCostAdjustmentEvents(
  poolMovement: Pick<CanadaIndexedMovementRef | AccountingFeeEntryView, 'assetId' | 'assetSymbol'>,
  valuedFees: CanadaValuedFee[],
  timestamp: Date,
  transactionId: number,
  eventIdPrefix: string,
  relatedEventId: string,
  identityConfig: CanadaTaxInputContextBuildOptions,
  provenance: {
    linkId?: number | undefined;
    provenanceKind: 'validated-link' | 'fee-only-carryover';
    sourceMovementFingerprint?: string | undefined;
    sourceTransactionId?: number | undefined;
    targetMovementFingerprint?: string | undefined;
  }
): Result<CanadaFeeAdjustmentEvent[], Error> {
  if (valuedFees.length === 0) {
    return ok([]);
  }

  const identityResult = resolvePoolIdentity(poolMovement, identityConfig);
  if (identityResult.isErr()) {
    return err(identityResult.error);
  }

  const events: CanadaFeeAdjustmentEvent[] = [];

  for (const [index, valuedFee] of valuedFees.entries()) {
    if (valuedFee.valuation.totalValueCad.isZero()) {
      continue;
    }

    events.push({
      eventId: `${eventIdPrefix}:${index}`,
      kind: 'fee-adjustment',
      adjustmentType: 'add-to-pool-cost',
      transactionId,
      timestamp,
      assetId: poolMovement.assetId,
      assetIdentityKey: identityResult.value.assetIdentityKey,
      taxPropertyKey: identityResult.value.taxPropertyKey,
      assetSymbol: poolMovement.assetSymbol,
      valuation: valuedFee.valuation,
      feeAssetId: valuedFee.feeAssetId,
      feeAssetIdentityKey: valuedFee.feeAssetIdentityKey,
      feeAssetSymbol: valuedFee.feeAssetSymbol,
      feeQuantity: valuedFee.feeQuantity,
      relatedEventId,
      priceAtTxTime: valuedFee.priceAtTxTime,
      provenanceKind: provenance.provenanceKind,
      linkId: provenance.linkId,
      sourceTransactionId: provenance.sourceTransactionId,
      sourceMovementFingerprint: provenance.sourceMovementFingerprint,
      targetMovementFingerprint: provenance.targetMovementFingerprint,
    });
  }

  return ok(events);
}
