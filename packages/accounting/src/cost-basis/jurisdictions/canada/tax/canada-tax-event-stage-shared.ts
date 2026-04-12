import type { AssetMovement, AssetMovementDraft, FeeMovementDraft } from '@exitbook/core';
import { err, isFiat, ok, type Result } from '@exitbook/foundation';

import { resolveTaxAssetIdentity } from '../../../model/tax-asset-identity.js';
import type { AccountingScopedTransaction } from '../../../standard/matching/build-cost-basis-scoped-transactions.js';

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
  inflowsByFingerprint: Map<string, { movement: AssetMovement; scopedTransaction: AccountingScopedTransaction }>;
  outflowsByFingerprint: Map<string, { movement: AssetMovement; scopedTransaction: AccountingScopedTransaction }>;
  scopedByTxId: Map<number, AccountingScopedTransaction>;
}

export function resolvePoolIdentity(
  item: AssetMovementDraft | FeeMovementDraft,
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
    {
      policy: identityConfig.taxAssetIdentityPolicy,
      relaxedSymbolIdentities: identityConfig.relaxedTaxIdentitySymbols,
      assetIdentityOverridesByAssetId: identityConfig.assetIdentityOverridesByAssetId,
    }
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

export function buildMovementIndexes(scopedTransactions: AccountingScopedTransaction[]): CanadaMovementIndexes {
  const inflowsByFingerprint = new Map<
    string,
    { movement: AssetMovement; scopedTransaction: AccountingScopedTransaction }
  >();
  const outflowsByFingerprint = new Map<
    string,
    { movement: AssetMovement; scopedTransaction: AccountingScopedTransaction }
  >();
  const scopedByTxId = new Map<number, AccountingScopedTransaction>();

  for (const scopedTransaction of scopedTransactions) {
    scopedByTxId.set(scopedTransaction.tx.id, scopedTransaction);
    for (const inflow of scopedTransaction.movements.inflows) {
      inflowsByFingerprint.set(inflow.movementFingerprint, { movement: inflow, scopedTransaction });
    }
    for (const outflow of scopedTransaction.movements.outflows) {
      outflowsByFingerprint.set(outflow.movementFingerprint, { movement: outflow, scopedTransaction });
    }
  }

  return { inflowsByFingerprint, outflowsByFingerprint, scopedByTxId };
}

export function buildAddToPoolCostAdjustmentEvents(
  poolMovement: AssetMovement,
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
