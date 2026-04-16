import type { PriceAtTxTime, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { AccountingTransactionView, ValidatedTransferSet } from '../../../../accounting-layer.js';
import type { UsdConversionRateProviderLike } from '../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import { resolveTaxAssetIdentity } from '../../../model/tax-asset-identity.js';
import { collectFiatFees, extractCryptoFee } from '../../../standard/lots/lot-fee-utils.js';

import type { CanadaAccountingLayerContext } from './canada-accounting-layer-context.js';
import {
  buildAddToPoolCostAdjustmentEvents,
  buildMovementIndexes,
  resolvePoolIdentity,
} from './canada-tax-event-stage-shared.js';
import { buildValuedFee, valueCanadaFees, valueCollectedFiatFees } from './canada-tax-fee-utils.js';
import { buildCanadaTaxPropertyKey } from './canada-tax-identity-utils.js';
import type {
  CanadaAcquisitionEvent,
  CanadaDispositionEvent,
  CanadaFeeAdjustmentEvent,
  CanadaTaxInputContextBuildOptions,
  CanadaTaxInputEvent,
} from './canada-tax-types.js';
import { normalizeDecimal } from './canada-tax-valuation.js';

interface SameAssetFeeLinkBinding {
  linkId: number;
  quantityBase: Decimal;
  sourceMovementFingerprint: string;
  targetMovementFingerprint: string;
}

interface SameAssetFeeSourceRef {
  assetIdentityKey: string;
  assetId: string;
  assetSymbol: Currency;
  feePriceAtTxTime?: PriceAtTxTime | undefined;
  linkBindings?: readonly SameAssetFeeLinkBinding[] | undefined;
  movementFingerprint?: string | undefined;
  processedTransaction: Transaction;
  provenanceKind: 'validated-link' | 'internal-transfer-carryover';
  quantityBase: Decimal;
  sourceQuantityBase: Decimal;
  sourceMovementFingerprint?: string | undefined;
  sourceTransactionId?: number | undefined;
  transaction: AccountingTransactionView | Transaction;
}

function collectAcquisitionEventsForTransaction(
  events: CanadaTaxInputEvent[],
  transactionId: number
): CanadaAcquisitionEvent[] {
  return events.filter(
    (event): event is CanadaAcquisitionEvent => event.transactionId === transactionId && event.kind === 'acquisition'
  );
}

function collectDispositionEventsForTransaction(
  events: CanadaTaxInputEvent[],
  transactionId: number
): CanadaDispositionEvent[] {
  return events.filter(
    (event): event is CanadaDispositionEvent => event.transactionId === transactionId && event.kind === 'disposition'
  );
}

function allocateCadAcrossEvents(
  totalCad: Decimal,
  targetEvent: CanadaAcquisitionEvent | CanadaDispositionEvent,
  candidateEvents: (CanadaAcquisitionEvent | CanadaDispositionEvent)[]
): Decimal {
  if (candidateEvents.length === 0 || totalCad.isZero()) {
    return parseDecimal('0');
  }

  const totalMovementCad = candidateEvents.reduce(
    (sum, event) => sum.plus(event.valuation.totalValueCad),
    parseDecimal('0')
  );
  if (!totalMovementCad.isZero()) {
    return totalCad.times(targetEvent.valuation.totalValueCad).dividedBy(totalMovementCad);
  }

  return totalCad.dividedBy(candidateEvents.length);
}

export async function applyGenericFeeAdjustments(params: {
  canadaAccountingContext: CanadaAccountingLayerContext;
  events: CanadaTaxInputEvent[];
  identityConfig: CanadaTaxInputContextBuildOptions;
  sameAssetTransferFeeEvents: CanadaFeeAdjustmentEvent[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
}): Promise<Result<void, Error>> {
  const { canadaAccountingContext, events, identityConfig, sameAssetTransferFeeEvents, usdConversionRateProvider } =
    params;

  for (const transactionView of canadaAccountingContext.accountingLayer.accountingTransactionViews) {
    const timestamp = new Date(transactionView.processedTransaction.datetime);
    const valuedFeesResult = await valueCanadaFees(
      transactionView.fees,
      timestamp,
      usdConversionRateProvider,
      identityConfig
    );
    if (valuedFeesResult.isErr()) {
      return err(valuedFeesResult.error);
    }

    const acquisitionEvents = collectAcquisitionEventsForTransaction(events, transactionView.processedTransaction.id);
    if (acquisitionEvents.length > 0) {
      const totalAcquisitionFeeCad = valuedFeesResult.value.reduce(
        (sum, valuedFee) => sum.plus(valuedFee.valuation.totalValueCad),
        parseDecimal('0')
      );

      for (const [index, event] of acquisitionEvents.entries()) {
        const allocatedCad =
          index === acquisitionEvents.length - 1
            ? normalizeDecimal(
                totalAcquisitionFeeCad.minus(
                  acquisitionEvents
                    .slice(0, index)
                    .reduce(
                      (sum, priorEvent) =>
                        sum.plus(allocateCadAcrossEvents(totalAcquisitionFeeCad, priorEvent, acquisitionEvents)),
                      parseDecimal('0')
                    )
                )
              )
            : normalizeDecimal(allocateCadAcrossEvents(totalAcquisitionFeeCad, event, acquisitionEvents));

        if (allocatedCad.gt(0)) {
          event.costBasisAdjustmentCad = (event.costBasisAdjustmentCad ?? parseDecimal('0')).plus(allocatedCad);
        }
      }
    }

    const dispositionEvents = collectDispositionEventsForTransaction(events, transactionView.processedTransaction.id);
    if (dispositionEvents.length > 0) {
      const sameAssetReservedCad = sameAssetTransferFeeEvents
        .filter((event) => event.transactionId === transactionView.processedTransaction.id)
        .reduce((sum, event) => sum.plus(event.valuation.totalValueCad), parseDecimal('0'));
      const onChainFees = valuedFeesResult.value.filter((valuedFee) =>
        transactionView.fees.some(
          (fee) =>
            fee.assetId === valuedFee.feeAssetId &&
            fee.assetSymbol === valuedFee.feeAssetSymbol &&
            fee.feeSettlement === 'on-chain'
        )
      );
      const totalDispositionFeeCad = onChainFees.reduce(
        (sum, valuedFee) => sum.plus(valuedFee.valuation.totalValueCad),
        parseDecimal('0')
      );
      const residualDispositionFeeCad = normalizeDecimal(totalDispositionFeeCad.minus(sameAssetReservedCad));
      if (residualDispositionFeeCad.lt(0)) {
        return err(
          new Error(
            `Same-asset transfer fee adjustments over-allocated on-chain fees in tx ${transactionView.processedTransaction.id}. ` +
              `Reserved ${sameAssetReservedCad.toFixed()} CAD from ${totalDispositionFeeCad.toFixed()} CAD.`
          )
        );
      }

      for (const [index, event] of dispositionEvents.entries()) {
        const allocatedCad =
          index === dispositionEvents.length - 1
            ? normalizeDecimal(
                residualDispositionFeeCad.minus(
                  dispositionEvents
                    .slice(0, index)
                    .reduce(
                      (sum, priorEvent) =>
                        sum.plus(allocateCadAcrossEvents(residualDispositionFeeCad, priorEvent, dispositionEvents)),
                      parseDecimal('0')
                    )
                )
              )
            : normalizeDecimal(allocateCadAcrossEvents(residualDispositionFeeCad, event, dispositionEvents));

        if (allocatedCad.gt(0)) {
          event.proceedsReductionCad = (event.proceedsReductionCad ?? parseDecimal('0')).plus(allocatedCad);
        }
      }
    }
  }

  return ok(undefined);
}

export async function buildValidatedTransferTargetFeeAdjustments(params: {
  canadaAccountingContext: CanadaAccountingLayerContext;
  identityConfig: CanadaTaxInputContextBuildOptions;
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}): Promise<Result<CanadaFeeAdjustmentEvent[], Error>> {
  const { canadaAccountingContext, identityConfig, usdConversionRateProvider, validatedTransfers } = params;
  const { inflowsByFingerprint, transactionViewsById } = buildMovementIndexes(canadaAccountingContext.indexes);
  const events: CanadaFeeAdjustmentEvent[] = [];

  for (const validatedLink of validatedTransfers.links) {
    const sourceTransactionView = transactionViewsById.get(validatedLink.link.sourceTransactionId);
    if (!sourceTransactionView) {
      return err(new Error(`Transfer source transaction ${validatedLink.link.sourceTransactionId} not found`));
    }

    const targetRef = inflowsByFingerprint.get(validatedLink.targetMovementFingerprint);
    if (!targetRef) {
      return err(new Error(`Transfer target movement ${validatedLink.targetMovementFingerprint} not found`));
    }

    const sourceFraction = validatedLink.link.sourceAmount.dividedBy(validatedLink.sourceMovementAmount);
    const targetFraction = validatedLink.link.targetAmount.dividedBy(validatedLink.targetMovementAmount);
    const fiatFeesResult = collectFiatFees(sourceTransactionView, targetRef.transactionView, {
      sourceFraction,
      targetFraction,
    });
    if (fiatFeesResult.isErr()) {
      return err(fiatFeesResult.error);
    }

    const valuedFeesResult = await valueCollectedFiatFees(
      fiatFeesResult.value,
      new Date(targetRef.transactionView.processedTransaction.datetime),
      usdConversionRateProvider,
      identityConfig
    );
    if (valuedFeesResult.isErr()) {
      return err(valuedFeesResult.error);
    }

    const eventResult = buildAddToPoolCostAdjustmentEvents(
      targetRef.movement,
      valuedFeesResult.value,
      new Date(targetRef.transactionView.processedTransaction.datetime),
      targetRef.transactionView.processedTransaction.id,
      `link:${validatedLink.link.id}:fee-adjustment:add-to-pool-cost`,
      `link:${validatedLink.link.id}:transfer-in`,
      identityConfig,
      {
        provenanceKind: 'validated-link',
        linkId: validatedLink.link.id,
        sourceMovementFingerprint: validatedLink.sourceMovementFingerprint,
        targetMovementFingerprint: validatedLink.targetMovementFingerprint,
      }
    );
    if (eventResult.isErr()) {
      return err(eventResult.error);
    }

    events.push(...eventResult.value);
  }

  return ok(events);
}

async function buildSameAssetTransferFeeAdjustmentEvent(
  ref: SameAssetFeeSourceRef,
  feeAmount: Decimal,
  feePriceAtTxTime: PriceAtTxTime | undefined,
  timestamp: Date,
  usdConversionRateProvider: UsdConversionRateProviderLike,
  identityConfig: CanadaTaxInputContextBuildOptions,
  provenance: {
    linkId?: number | undefined;
    relatedEventId?: string | undefined;
    sourceMovementFingerprint?: string | undefined;
    targetMovementFingerprint?: string | undefined;
  },
  eventId: string
): Promise<Result<CanadaFeeAdjustmentEvent | undefined, Error>> {
  if (feeAmount.lte(0)) {
    return ok(undefined);
  }

  const valuedFeeResult = await buildValuedFee({
    fee: {
      amount: feeAmount,
      assetId: ref.assetId,
      assetSymbol: ref.assetSymbol,
      priceAtTxTime: feePriceAtTxTime,
    },
    timestamp,
    usdConversionRateProvider,
    identityConfig,
  });
  if (valuedFeeResult.isErr()) {
    return err(valuedFeeResult.error);
  }

  const poolIdentityResult = buildCanadaTaxPropertyKey(ref.assetIdentityKey);
  if (poolIdentityResult.isErr()) {
    return err(poolIdentityResult.error);
  }

  return ok({
    eventId,
    kind: 'fee-adjustment',
    adjustmentType: 'same-asset-transfer-fee-add-to-basis',
    transactionId: ref.processedTransaction.id,
    timestamp,
    assetId: ref.assetId,
    assetIdentityKey: ref.assetIdentityKey,
    taxPropertyKey: poolIdentityResult.value,
    assetSymbol: ref.assetSymbol,
    valuation: valuedFeeResult.value.valuation,
    feeAssetId: valuedFeeResult.value.feeAssetId,
    feeAssetIdentityKey: valuedFeeResult.value.feeAssetIdentityKey,
    feeAssetSymbol: valuedFeeResult.value.feeAssetSymbol,
    feeQuantity: feeAmount,
    quantityReduced: feeAmount,
    priceAtTxTime: valuedFeeResult.value.priceAtTxTime,
    provenanceKind: ref.provenanceKind,
    linkId: provenance.linkId,
    sourceTransactionId: ref.sourceTransactionId,
    sourceMovementFingerprint: provenance.sourceMovementFingerprint,
    targetMovementFingerprint: provenance.targetMovementFingerprint,
    relatedEventId: provenance.relatedEventId,
  });
}

async function buildSameAssetTransferFeeAdjustmentEventsForRef(
  ref: SameAssetFeeSourceRef,
  totalFeeAmount: Decimal,
  feePriceAtTxTime: PriceAtTxTime | undefined,
  timestamp: Date,
  usdConversionRateProvider: UsdConversionRateProviderLike,
  identityConfig: CanadaTaxInputContextBuildOptions,
  eventIdPrefix: string
): Promise<Result<CanadaFeeAdjustmentEvent[], Error>> {
  if (totalFeeAmount.lte(0)) {
    return ok([]);
  }

  if (ref.provenanceKind === 'validated-link') {
    if (!ref.linkBindings || ref.linkBindings.length === 0) {
      return err(
        new Error(
          `Validated same-asset fee source ${ref.movementFingerprint ?? ref.sourceMovementFingerprint ?? 'unknown'} ` +
            `is missing link bindings`
        )
      );
    }

    const totalLinkQuantityBase = ref.linkBindings.reduce(
      (sum, binding) => sum.plus(binding.quantityBase),
      parseDecimal('0')
    );
    if (totalLinkQuantityBase.lte(0)) {
      return err(
        new Error(
          `Validated same-asset fee source ${ref.movementFingerprint ?? ref.sourceMovementFingerprint ?? 'unknown'} ` +
            `requires a positive linked quantity base`
        )
      );
    }

    const events: CanadaFeeAdjustmentEvent[] = [];
    let allocatedFeeAmount = parseDecimal('0');

    for (const [index, binding] of ref.linkBindings.entries()) {
      const feeAmount =
        index === ref.linkBindings.length - 1
          ? normalizeDecimal(totalFeeAmount.minus(allocatedFeeAmount))
          : normalizeDecimal(totalFeeAmount.times(binding.quantityBase).dividedBy(totalLinkQuantityBase));
      allocatedFeeAmount = allocatedFeeAmount.plus(feeAmount);

      const eventResult = await buildSameAssetTransferFeeAdjustmentEvent(
        ref,
        feeAmount,
        feePriceAtTxTime,
        timestamp,
        usdConversionRateProvider,
        identityConfig,
        {
          linkId: binding.linkId,
          relatedEventId: `link:${binding.linkId}:transfer-out`,
          sourceMovementFingerprint: binding.sourceMovementFingerprint,
          targetMovementFingerprint: binding.targetMovementFingerprint,
        },
        `${eventIdPrefix}:link:${binding.linkId}`
      );
      if (eventResult.isErr()) {
        return err(eventResult.error);
      }

      if (eventResult.value) {
        events.push(eventResult.value);
      }
    }

    return ok(events);
  }

  const eventResult = await buildSameAssetTransferFeeAdjustmentEvent(
    ref,
    totalFeeAmount,
    feePriceAtTxTime,
    timestamp,
    usdConversionRateProvider,
    identityConfig,
    {
      relatedEventId: ref.movementFingerprint ? `movement:${ref.movementFingerprint}` : undefined,
      sourceMovementFingerprint: ref.sourceMovementFingerprint ?? ref.movementFingerprint,
    },
    eventIdPrefix
  );
  if (eventResult.isErr()) {
    return err(eventResult.error);
  }

  return ok(eventResult.value ? [eventResult.value] : []);
}

function buildSameAssetFeeSourceRefs(
  canadaAccountingContext: CanadaAccountingLayerContext,
  validatedTransfers: ValidatedTransferSet,
  identityConfig: CanadaTaxInputContextBuildOptions
): Result<SameAssetFeeSourceRef[], Error> {
  const { outflowsByFingerprint } = buildMovementIndexes(canadaAccountingContext.indexes);
  const refs: SameAssetFeeSourceRef[] = [];

  for (const [sourceMovementFingerprint, validatedLinks] of validatedTransfers.bySourceMovementFingerprint.entries()) {
    if (validatedLinks.length === 0) {
      continue;
    }

    const outflowRef = outflowsByFingerprint.get(sourceMovementFingerprint);
    if (!outflowRef) {
      return err(new Error(`Validated transfer source movement ${sourceMovementFingerprint} not found`));
    }

    const identityResult = resolvePoolIdentity(outflowRef.movement, identityConfig);
    if (identityResult.isErr()) {
      return err(identityResult.error);
    }

    const cryptoFeeResult = extractCryptoFee(outflowRef.transactionView, outflowRef.movement.assetId);
    if (cryptoFeeResult.isErr()) {
      return err(cryptoFeeResult.error);
    }

    const sourceMovementAmount = validatedLinks[0]!.sourceMovementAmount;
    for (const validatedLink of validatedLinks) {
      if (!validatedLink.sourceMovementAmount.eq(sourceMovementAmount)) {
        return err(
          new Error(
            `Validated transfer links for source movement ${sourceMovementFingerprint} disagree on source amount: ` +
              `${validatedLink.sourceMovementAmount.toFixed()} vs ${sourceMovementAmount.toFixed()}`
          )
        );
      }
    }

    refs.push({
      assetIdentityKey: identityResult.value.assetIdentityKey,
      assetId: outflowRef.movement.assetId,
      assetSymbol: outflowRef.movement.assetSymbol,
      feePriceAtTxTime: cryptoFeeResult.value.priceAtTxTime,
      linkBindings: validatedLinks.map((validatedLink) => ({
        linkId: validatedLink.link.id,
        quantityBase: validatedLink.link.sourceAmount,
        sourceMovementFingerprint: validatedLink.sourceMovementFingerprint,
        targetMovementFingerprint: validatedLink.targetMovementFingerprint,
      })),
      movementFingerprint: sourceMovementFingerprint,
      processedTransaction: outflowRef.transactionView.processedTransaction,
      provenanceKind: 'validated-link',
      quantityBase: validatedLinks.reduce(
        (sum, validatedLink) => sum.plus(validatedLink.link.sourceAmount),
        parseDecimal('0')
      ),
      sourceQuantityBase: sourceMovementAmount,
      sourceMovementFingerprint,
      transaction: outflowRef.transactionView,
    });
  }

  for (const resolvedCarryover of canadaAccountingContext.resolvedInternalTransferCarryovers) {
    const carryoverIdentityResult = resolveTaxAssetIdentity(
      {
        assetId: resolvedCarryover.source.entry.assetId,
        assetSymbol: resolvedCarryover.source.entry.assetSymbol,
      },
      { assetIdentityOverridesByAssetId: identityConfig.assetIdentityOverridesByAssetId }
    );
    if (carryoverIdentityResult.isErr()) {
      return err(
        new Error(
          `Failed to resolve carryover asset identity for ${resolvedCarryover.source.entry.assetSymbol} ` +
            `(${resolvedCarryover.source.entry.assetId}) in source tx ${resolvedCarryover.source.processedTransaction.id}: ` +
            `${carryoverIdentityResult.error.message}`
        )
      );
    }

    refs.push({
      assetIdentityKey: carryoverIdentityResult.value.identityKey,
      assetId: resolvedCarryover.source.entry.assetId,
      assetSymbol: resolvedCarryover.source.entry.assetSymbol,
      feePriceAtTxTime: resolvedCarryover.fee?.fee.priceAtTxTime,
      movementFingerprint: resolvedCarryover.source.movement.movementFingerprint,
      processedTransaction: resolvedCarryover.source.processedTransaction,
      provenanceKind: 'internal-transfer-carryover',
      quantityBase: resolvedCarryover.source.entry.quantity,
      sourceQuantityBase: resolvedCarryover.source.entry.quantity,
      sourceTransactionId: resolvedCarryover.source.processedTransaction.id,
      sourceMovementFingerprint: resolvedCarryover.source.movement.movementFingerprint,
      transaction: resolvedCarryover.source.transactionView ?? resolvedCarryover.source.processedTransaction,
    });
  }

  return ok(refs);
}

export async function buildSameAssetTransferFeeAdjustments(params: {
  canadaAccountingContext: CanadaAccountingLayerContext;
  identityConfig: CanadaTaxInputContextBuildOptions;
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedTransferSet;
}): Promise<Result<CanadaFeeAdjustmentEvent[], Error>> {
  const { canadaAccountingContext, identityConfig, usdConversionRateProvider, validatedTransfers } = params;
  const refsResult = buildSameAssetFeeSourceRefs(canadaAccountingContext, validatedTransfers, identityConfig);
  if (refsResult.isErr()) {
    return err(refsResult.error);
  }

  const refsByTransactionAndAsset = new Map<string, SameAssetFeeSourceRef[]>();
  for (const ref of refsResult.value) {
    const key = `${ref.processedTransaction.id}:${ref.assetId}`;
    const existingRefs = refsByTransactionAndAsset.get(key) ?? [];
    existingRefs.push(ref);
    refsByTransactionAndAsset.set(key, existingRefs);
  }

  const events: CanadaFeeAdjustmentEvent[] = [];

  for (const [key, refs] of refsByTransactionAndAsset.entries()) {
    const processedTransaction = refs[0]!.processedTransaction;
    const transaction = refs[0]!.transaction;
    const cryptoFeeResult = extractCryptoFee(transaction, refs[0]!.assetId);
    if (cryptoFeeResult.isErr()) {
      return err(cryptoFeeResult.error);
    }

    const cryptoFee = cryptoFeeResult.value;
    if (cryptoFee.amount.isZero()) {
      continue;
    }

    const totalInternalQuantityBase = refs.reduce((sum, ref) => sum.plus(ref.quantityBase), parseDecimal('0'));
    const totalSourceQuantityBase = refs.reduce((sum, ref) => sum.plus(ref.sourceQuantityBase), parseDecimal('0'));
    if (totalSourceQuantityBase.lte(0) || totalInternalQuantityBase.lte(0)) {
      return err(
        new Error(
          `Same-asset fee allocation requires positive quantity bases for tx ${processedTransaction.id} asset ${refs[0]!.assetId}`
        )
      );
    }

    const totalAllocatedInternalFeeQuantity = normalizeDecimal(
      cryptoFee.amount.times(totalInternalQuantityBase).dividedBy(totalSourceQuantityBase)
    );
    let allocatedQuantitySoFar = parseDecimal('0');

    for (const [index, ref] of refs.entries()) {
      const allocatedFeeQuantity =
        index === refs.length - 1
          ? normalizeDecimal(totalAllocatedInternalFeeQuantity.minus(allocatedQuantitySoFar))
          : normalizeDecimal(
              totalAllocatedInternalFeeQuantity.times(ref.quantityBase).dividedBy(totalInternalQuantityBase)
            );
      allocatedQuantitySoFar = allocatedQuantitySoFar.plus(allocatedFeeQuantity);

      const eventResult = await buildSameAssetTransferFeeAdjustmentEventsForRef(
        ref,
        allocatedFeeQuantity,
        cryptoFee.priceAtTxTime ?? ref.feePriceAtTxTime,
        new Date(processedTransaction.datetime),
        usdConversionRateProvider,
        identityConfig,
        `tx:${processedTransaction.id}:${key}:${index}:same-asset-transfer-fee`
      );
      if (eventResult.isErr()) {
        return err(eventResult.error);
      }

      events.push(...eventResult.value);
    }
  }

  return ok(events);
}
