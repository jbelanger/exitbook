import type { AssetMovementDraft, FeeMovementDraft, PriceAtTxTime, AssetMovement } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, isFiat, ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { IFxRateProvider } from '../../../../price-enrichment/shared/types.js';
import { resolveTaxAssetIdentity } from '../../../model/tax-asset-identity.js';
import { collectFiatFees, extractCryptoFee } from '../../../standard/lots/lot-fee-utils.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
} from '../../../standard/matching/build-cost-basis-scoped-transactions.js';
import type {
  ValidatedScopedTransferLink,
  ValidatedScopedTransferSet,
} from '../../../standard/matching/validated-scoped-transfer-links.js';

import { buildValuedFee, valueCollectedFiatFees, valueScopedFees } from './canada-tax-fee-utils.js';
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
import { buildCanadaTaxValuation, normalizeDecimal } from './canada-tax-valuation.js';

type CanadaMovementEvent =
  | CanadaAcquisitionEvent
  | CanadaDispositionEvent
  | CanadaTransferInEvent
  | CanadaTransferOutEvent;

interface CanadaPoolIdentity {
  assetIdentityKey: string;
  taxPropertyKey: string;
}

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
  provenanceKind: 'validated-link' | 'fee-only-carryover';
  quantityBase: Decimal;
  sourceQuantityBase: Decimal;
  scopedTransaction: AccountingScopedTransaction;
  sourceTransactionId?: number | undefined;
  sourceMovementFingerprint?: string | undefined;
}

function resolvePoolIdentity(
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

function getTransferComparableQuantity(movement: AssetMovementDraft): Decimal {
  return movement.netAmount ?? movement.grossAmount;
}

function sortValidatedLinks(links: ValidatedScopedTransferLink[]): ValidatedScopedTransferLink[] {
  return [...links].sort((left, right) => left.link.id - right.link.id);
}

function getResidualQuantity(
  totalQuantity: Decimal,
  linkedQuantity: Decimal,
  description: string
): Result<Decimal, Error> {
  if (linkedQuantity.gt(totalQuantity)) {
    return err(
      new Error(
        `${description} over-allocates linked quantity. ` +
          `Linked ${linkedQuantity.toFixed()} from total ${totalQuantity.toFixed()}.`
      )
    );
  }

  return ok(normalizeDecimal(totalQuantity.minus(linkedQuantity)));
}

function buildEventIndex(events: CanadaTaxInputEvent[]): {
  byMovementFingerprint: Map<string, CanadaTaxInputEvent[]>;
  byTransactionId: Map<number, CanadaTaxInputEvent[]>;
} {
  const byMovementFingerprint = new Map<string, CanadaTaxInputEvent[]>();
  const byTransactionId = new Map<number, CanadaTaxInputEvent[]>();

  for (const event of events) {
    const existingByTx = byTransactionId.get(event.transactionId) ?? [];
    existingByTx.push(event);
    byTransactionId.set(event.transactionId, existingByTx);

    const movementFingerprint = event.movementFingerprint;
    if (!movementFingerprint) continue;

    const existingByMovement = byMovementFingerprint.get(movementFingerprint) ?? [];
    existingByMovement.push(event);
    byMovementFingerprint.set(movementFingerprint, existingByMovement);
  }

  return { byMovementFingerprint, byTransactionId };
}

function buildMovementIndexes(scopedTransactions: AccountingScopedTransaction[]): {
  inflowsByFingerprint: Map<string, { movement: AssetMovement; scopedTransaction: AccountingScopedTransaction }>;
  outflowsByFingerprint: Map<string, { movement: AssetMovement; scopedTransaction: AccountingScopedTransaction }>;
  scopedByTxId: Map<number, AccountingScopedTransaction>;
} {
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

async function buildMovementEvent(
  scopedTransaction: AccountingScopedTransaction,
  movement: AssetMovement,
  quantity: Decimal,
  kind: CanadaMovementEvent['kind'],
  eventId: string,
  fxProvider: IFxRateProvider,
  identityConfig: CanadaTaxInputContextBuildOptions,
  provenance: {
    linkId?: number | undefined;
    provenanceKind: 'scoped-movement' | 'validated-link';
    sourceMovementFingerprint?: string | undefined;
    targetMovementFingerprint?: string | undefined;
  }
): Promise<Result<CanadaMovementEvent | undefined, Error>> {
  if (isFiat(movement.assetSymbol)) {
    return ok(undefined);
  }

  if (!movement.priceAtTxTime) {
    return err(new Error(`Missing priceAtTxTime for ${kind} ${movement.assetSymbol} in tx ${scopedTransaction.tx.id}`));
  }

  const identityResult = resolvePoolIdentity(movement, identityConfig);
  if (identityResult.isErr()) {
    return err(identityResult.error);
  }

  const valuationResult = await buildCanadaTaxValuation({
    priceAtTxTime: movement.priceAtTxTime,
    quantity,
    timestamp: new Date(scopedTransaction.tx.datetime),
    fxProvider,
  });
  if (valuationResult.isErr()) {
    return err(valuationResult.error);
  }

  const baseEvent = {
    eventId,
    transactionId: scopedTransaction.tx.id,
    timestamp: new Date(scopedTransaction.tx.datetime),
    assetId: movement.assetId,
    assetIdentityKey: identityResult.value.assetIdentityKey,
    taxPropertyKey: identityResult.value.taxPropertyKey,
    assetSymbol: movement.assetSymbol,
    valuation: valuationResult.value,
    priceAtTxTime: movement.priceAtTxTime,
    movementFingerprint: provenance.provenanceKind === 'scoped-movement' ? movement.movementFingerprint : undefined,
    provenanceKind: provenance.provenanceKind,
    linkId: provenance.linkId,
    sourceMovementFingerprint: provenance.sourceMovementFingerprint,
    targetMovementFingerprint: provenance.targetMovementFingerprint,
  };

  switch (kind) {
    case 'acquisition':
      return ok({
        ...baseEvent,
        kind,
        quantity,
      });
    case 'disposition':
      return ok({
        ...baseEvent,
        kind,
        quantity,
      });
    case 'transfer-in':
      return ok({
        ...baseEvent,
        kind,
        quantity,
      });
    case 'transfer-out':
      return ok({
        ...baseEvent,
        kind,
        quantity,
      });
  }
}

async function projectTransferAwareMovementEvents(
  scopedTransaction: AccountingScopedTransaction,
  movement: AssetMovement,
  direction: 'inflow' | 'outflow',
  validatedLinks: ValidatedScopedTransferLink[],
  fxProvider: IFxRateProvider,
  identityConfig: CanadaTaxInputContextBuildOptions
): Promise<Result<CanadaMovementEvent[], Error>> {
  const sortedLinks = sortValidatedLinks(validatedLinks);
  const transferEventKind = direction === 'inflow' ? 'transfer-in' : 'transfer-out';
  const residualEventKind = direction === 'inflow' ? 'acquisition' : 'disposition';
  if (sortedLinks.length === 0) {
    const directEventResult = await buildMovementEvent(
      scopedTransaction,
      movement,
      movement.grossAmount,
      residualEventKind,
      `tx:${scopedTransaction.tx.id}:${residualEventKind}:${movement.movementFingerprint}:residual`,
      fxProvider,
      identityConfig,
      {
        provenanceKind: 'scoped-movement',
      }
    );
    if (directEventResult.isErr()) {
      return err(directEventResult.error);
    }

    return ok(directEventResult.value ? [directEventResult.value] : []);
  }

  const totalMovementQuantity = getTransferComparableQuantity(movement);
  const linkedQuantity = sortedLinks.reduce(
    (sum, validatedLink) =>
      sum.plus(direction === 'inflow' ? validatedLink.link.targetAmount : validatedLink.link.sourceAmount),
    parseDecimal('0')
  );
  const residualQuantityResult = getResidualQuantity(
    totalMovementQuantity,
    linkedQuantity,
    `${transferEventKind} movement ${movement.movementFingerprint}`
  );
  if (residualQuantityResult.isErr()) {
    return err(residualQuantityResult.error);
  }

  const events: CanadaMovementEvent[] = [];

  for (const validatedLink of sortedLinks) {
    const transferQuantity = direction === 'inflow' ? validatedLink.link.targetAmount : validatedLink.link.sourceAmount;
    const eventResult = await buildMovementEvent(
      scopedTransaction,
      movement,
      transferQuantity,
      transferEventKind,
      `link:${validatedLink.link.id}:${transferEventKind}`,
      fxProvider,
      identityConfig,
      {
        linkId: validatedLink.link.id,
        provenanceKind: 'validated-link',
        sourceMovementFingerprint: validatedLink.sourceMovementFingerprint,
        targetMovementFingerprint: validatedLink.targetMovementFingerprint,
      }
    );
    if (eventResult.isErr()) {
      return err(eventResult.error);
    }

    if (eventResult.value) {
      events.push(eventResult.value);
    }
  }

  if (residualQuantityResult.value.gt(0)) {
    const residualEventResult = await buildMovementEvent(
      scopedTransaction,
      movement,
      residualQuantityResult.value,
      residualEventKind,
      `tx:${scopedTransaction.tx.id}:${residualEventKind}:${movement.movementFingerprint}:residual`,
      fxProvider,
      identityConfig,
      {
        provenanceKind: 'scoped-movement',
      }
    );
    if (residualEventResult.isErr()) {
      return err(residualEventResult.error);
    }

    if (residualEventResult.value) {
      events.push(residualEventResult.value);
    }
  }

  return ok(events);
}

export async function projectCanadaMovementEvents(params: {
  fxProvider: IFxRateProvider;
  identityConfig: CanadaTaxInputContextBuildOptions;
  scopedTransactions: AccountingScopedTransaction[];
  validatedTransfers: ValidatedScopedTransferSet;
}): Promise<Result<CanadaMovementEvent[], Error>> {
  const { fxProvider, identityConfig, scopedTransactions, validatedTransfers } = params;
  const events: CanadaMovementEvent[] = [];

  for (const scopedTransaction of scopedTransactions) {
    for (const inflow of scopedTransaction.movements.inflows) {
      const inflowEventsResult = await projectTransferAwareMovementEvents(
        scopedTransaction,
        inflow,
        'inflow',
        validatedTransfers.byTargetMovementFingerprint.get(inflow.movementFingerprint) ?? [],
        fxProvider,
        identityConfig
      );
      if (inflowEventsResult.isErr()) {
        return err(inflowEventsResult.error);
      }
      events.push(...inflowEventsResult.value);
    }

    for (const outflow of scopedTransaction.movements.outflows) {
      const outflowEventsResult = await projectTransferAwareMovementEvents(
        scopedTransaction,
        outflow,
        'outflow',
        validatedTransfers.bySourceMovementFingerprint.get(outflow.movementFingerprint) ?? [],
        fxProvider,
        identityConfig
      );
      if (outflowEventsResult.isErr()) {
        return err(outflowEventsResult.error);
      }
      events.push(...outflowEventsResult.value);
    }
  }

  return ok(events);
}

function buildAddToPoolCostAdjustmentEvents(
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

async function buildSameAssetTransferFeeAdjustmentEvent(
  ref: SameAssetFeeSourceRef,
  feeAmount: Decimal,
  feePriceAtTxTime: PriceAtTxTime | undefined,
  timestamp: Date,
  fxProvider: IFxRateProvider,
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
    fxProvider,
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
    transactionId: ref.scopedTransaction.tx.id,
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
  fxProvider: IFxRateProvider,
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
        fxProvider,
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
    fxProvider,
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

function convertCarryoverTargetToTransferIn(
  acquisitionEvent: CanadaAcquisitionEvent,
  carryover: FeeOnlyInternalCarryover,
  targetMovementFingerprint: string
): CanadaTransferInEvent {
  return {
    eventId: `carryover:${carryover.sourceTransactionId}:${targetMovementFingerprint}:transfer-in`,
    kind: 'transfer-in',
    transactionId: acquisitionEvent.transactionId,
    timestamp: acquisitionEvent.timestamp,
    assetId: acquisitionEvent.assetId,
    assetIdentityKey: acquisitionEvent.assetIdentityKey,
    taxPropertyKey: acquisitionEvent.taxPropertyKey,
    assetSymbol: acquisitionEvent.assetSymbol,
    quantity: acquisitionEvent.quantity,
    valuation: acquisitionEvent.valuation,
    priceAtTxTime: acquisitionEvent.priceAtTxTime,
    provenanceKind: 'fee-only-carryover',
    sourceTransactionId: carryover.sourceTransactionId,
    sourceMovementFingerprint: carryover.sourceMovementFingerprint,
    targetMovementFingerprint,
  };
}

export async function applyCarryoverSemantics(params: {
  events: CanadaTaxInputEvent[];
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
  fxProvider: IFxRateProvider;
  identityConfig: CanadaTaxInputContextBuildOptions;
  scopedTransactions: AccountingScopedTransaction[];
}): Promise<Result<CanadaTaxInputEvent[], Error>> {
  const { events, feeOnlyInternalCarryovers, fxProvider, identityConfig, scopedTransactions } = params;
  const { byMovementFingerprint } = buildEventIndex(events);
  const { inflowsByFingerprint, scopedByTxId } = buildMovementIndexes(scopedTransactions);
  const finalizedEvents = [...events];
  const feeAdjustmentEvents: CanadaFeeAdjustmentEvent[] = [];

  for (const carryover of feeOnlyInternalCarryovers) {
    const sourceTransaction = scopedByTxId.get(carryover.sourceTransactionId);
    if (!sourceTransaction) {
      return err(new Error(`Carryover source transaction ${carryover.sourceTransactionId} not found`));
    }

    for (const target of carryover.targets) {
      const indexedEvents = byMovementFingerprint.get(target.targetMovementFingerprint) ?? [];
      const acquisitionEvent = indexedEvents.find((event) => event.kind === 'acquisition');
      if (!acquisitionEvent) {
        const conflictingEvent = indexedEvents[0];
        if (conflictingEvent) {
          return err(
            new Error(
              `Movement ${target.targetMovementFingerprint} is already classified as ${conflictingEvent.kind} ` +
                `and cannot also be a fee-only carryover target`
            )
          );
        }

        return err(
          new Error(`Carryover target movement ${target.targetMovementFingerprint} was not projected as acquisition`)
        );
      }

      const eventIndex = finalizedEvents.findIndex((event) => event.eventId === acquisitionEvent.eventId);
      if (eventIndex < 0) {
        return err(
          new Error(`Projected acquisition event ${acquisitionEvent.eventId} not found during carryover rewrite`)
        );
      }

      finalizedEvents[eventIndex] = convertCarryoverTargetToTransferIn(
        acquisitionEvent,
        carryover,
        target.targetMovementFingerprint
      );

      const targetRef = inflowsByFingerprint.get(target.targetMovementFingerprint);
      if (!targetRef) {
        return err(
          new Error(`Carryover target movement ${target.targetMovementFingerprint} not found in scoped inflow index`)
        );
      }

      const sourceFraction = target.quantity.dividedBy(carryover.retainedQuantity);
      const targetFraction = target.quantity.dividedBy(targetRef.movement.grossAmount);
      const fiatFeesResult = collectFiatFees(sourceTransaction, targetRef.scopedTransaction, {
        sourceFraction,
        targetFraction,
      });
      if (fiatFeesResult.isErr()) {
        return err(fiatFeesResult.error);
      }

      const valuedFeesResult = await valueCollectedFiatFees(
        fiatFeesResult.value,
        new Date(targetRef.scopedTransaction.tx.datetime),
        fxProvider,
        identityConfig
      );
      if (valuedFeesResult.isErr()) {
        return err(valuedFeesResult.error);
      }

      const feeAdjustmentEventsResult = buildAddToPoolCostAdjustmentEvents(
        targetRef.movement,
        valuedFeesResult.value,
        new Date(targetRef.scopedTransaction.tx.datetime),
        targetRef.scopedTransaction.tx.id,
        `carryover:${carryover.sourceTransactionId}:${target.targetMovementFingerprint}:fee-adjustment`,
        `carryover:${carryover.sourceTransactionId}:${target.targetMovementFingerprint}:transfer-in`,
        identityConfig,
        {
          provenanceKind: 'fee-only-carryover',
          sourceTransactionId: carryover.sourceTransactionId,
          sourceMovementFingerprint: carryover.sourceMovementFingerprint,
          targetMovementFingerprint: target.targetMovementFingerprint,
        }
      );
      if (feeAdjustmentEventsResult.isErr()) {
        return err(feeAdjustmentEventsResult.error);
      }

      feeAdjustmentEvents.push(...feeAdjustmentEventsResult.value);
    }
  }

  return ok([...finalizedEvents, ...feeAdjustmentEvents]);
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
  events: CanadaTaxInputEvent[];
  fxProvider: IFxRateProvider;
  identityConfig: CanadaTaxInputContextBuildOptions;
  sameAssetTransferFeeEvents: CanadaFeeAdjustmentEvent[];
  scopedTransactions: AccountingScopedTransaction[];
}): Promise<Result<void, Error>> {
  const { events, fxProvider, identityConfig, sameAssetTransferFeeEvents, scopedTransactions } = params;
  for (const scopedTransaction of scopedTransactions) {
    const timestamp = new Date(scopedTransaction.tx.datetime);
    const valuedFeesResult = await valueScopedFees(scopedTransaction.fees, timestamp, fxProvider, identityConfig);
    if (valuedFeesResult.isErr()) {
      return err(valuedFeesResult.error);
    }

    const acquisitionEvents = collectAcquisitionEventsForTransaction(events, scopedTransaction.tx.id);
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

    const dispositionEvents = collectDispositionEventsForTransaction(events, scopedTransaction.tx.id);
    if (dispositionEvents.length > 0) {
      const sameAssetReservedCad = sameAssetTransferFeeEvents
        .filter((event) => event.transactionId === scopedTransaction.tx.id)
        .reduce((sum, event) => sum.plus(event.valuation.totalValueCad), parseDecimal('0'));
      const onChainFees = valuedFeesResult.value.filter((valuedFee) =>
        scopedTransaction.fees.some(
          (fee) =>
            fee.assetId === valuedFee.feeAssetId &&
            fee.assetSymbol === valuedFee.feeAssetSymbol &&
            fee.settlement === 'on-chain'
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
            `Same-asset transfer fee adjustments over-allocated on-chain fees in tx ${scopedTransaction.tx.id}. ` +
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
  fxProvider: IFxRateProvider;
  identityConfig: CanadaTaxInputContextBuildOptions;
  scopedTransactions: AccountingScopedTransaction[];
  validatedTransfers: ValidatedScopedTransferSet;
}): Promise<Result<CanadaFeeAdjustmentEvent[], Error>> {
  const { fxProvider, identityConfig, scopedTransactions, validatedTransfers } = params;
  const { inflowsByFingerprint, scopedByTxId } = buildMovementIndexes(scopedTransactions);
  const events: CanadaFeeAdjustmentEvent[] = [];

  for (const validatedLink of validatedTransfers.links) {
    const sourceTransaction = scopedByTxId.get(validatedLink.link.sourceTransactionId);
    if (!sourceTransaction) {
      return err(new Error(`Transfer source transaction ${validatedLink.link.sourceTransactionId} not found`));
    }

    const targetRef = inflowsByFingerprint.get(validatedLink.targetMovementFingerprint);
    if (!targetRef) {
      return err(new Error(`Transfer target movement ${validatedLink.targetMovementFingerprint} not found`));
    }

    const sourceFraction = validatedLink.link.sourceAmount.dividedBy(validatedLink.sourceMovementAmount);
    const targetFraction = validatedLink.link.targetAmount.dividedBy(validatedLink.targetMovementAmount);
    const fiatFeesResult = collectFiatFees(sourceTransaction, targetRef.scopedTransaction, {
      sourceFraction,
      targetFraction,
    });
    if (fiatFeesResult.isErr()) {
      return err(fiatFeesResult.error);
    }

    const valuedFeesResult = await valueCollectedFiatFees(
      fiatFeesResult.value,
      new Date(targetRef.scopedTransaction.tx.datetime),
      fxProvider,
      identityConfig
    );
    if (valuedFeesResult.isErr()) {
      return err(valuedFeesResult.error);
    }

    const eventResult = buildAddToPoolCostAdjustmentEvents(
      targetRef.movement,
      valuedFeesResult.value,
      new Date(targetRef.scopedTransaction.tx.datetime),
      targetRef.scopedTransaction.tx.id,
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

function buildSameAssetFeeSourceRefs(
  scopedTransactions: AccountingScopedTransaction[],
  validatedTransfers: ValidatedScopedTransferSet,
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  identityConfig: CanadaTaxInputContextBuildOptions
): Result<SameAssetFeeSourceRef[], Error> {
  const { outflowsByFingerprint, scopedByTxId } = buildMovementIndexes(scopedTransactions);
  const refs: SameAssetFeeSourceRef[] = [];

  for (const [sourceMovementFingerprint, validatedLinks] of validatedTransfers.bySourceMovementFingerprint.entries()) {
    if (validatedLinks.length === 0) continue;

    const outflowRef = outflowsByFingerprint.get(sourceMovementFingerprint);
    if (!outflowRef) {
      return err(new Error(`Validated transfer source movement ${sourceMovementFingerprint} not found`));
    }

    const identityResult = resolvePoolIdentity(outflowRef.movement, identityConfig);
    if (identityResult.isErr()) {
      return err(identityResult.error);
    }

    const cryptoFeeResult = extractCryptoFee(outflowRef.scopedTransaction, outflowRef.movement.assetId);
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
      provenanceKind: 'validated-link',
      quantityBase: validatedLinks.reduce(
        (sum, validatedLink) => sum.plus(validatedLink.link.sourceAmount),
        parseDecimal('0')
      ),
      sourceQuantityBase: sourceMovementAmount,
      scopedTransaction: outflowRef.scopedTransaction,
      sourceMovementFingerprint,
    });
  }

  for (const carryover of feeOnlyInternalCarryovers) {
    const scopedTransaction = scopedByTxId.get(carryover.sourceTransactionId);
    if (!scopedTransaction) {
      return err(new Error(`Carryover source transaction ${carryover.sourceTransactionId} not found`));
    }

    const carryoverIdentityResult = resolveTaxAssetIdentity(
      {
        assetId: carryover.assetId,
        assetSymbol: carryover.assetSymbol,
      },
      {
        policy: identityConfig.taxAssetIdentityPolicy,
        relaxedSymbolIdentities: identityConfig.relaxedTaxIdentitySymbols,
      }
    );
    if (carryoverIdentityResult.isErr()) {
      return err(
        new Error(
          `Failed to resolve carryover asset identity for ${carryover.assetSymbol} (${carryover.assetId}) ` +
            `in source tx ${carryover.sourceTransactionId}: ${carryoverIdentityResult.error.message}`
        )
      );
    }

    refs.push({
      assetIdentityKey: carryoverIdentityResult.value.identityKey,
      assetId: carryover.assetId,
      assetSymbol: carryover.assetSymbol,
      feePriceAtTxTime: carryover.fee.priceAtTxTime,
      movementFingerprint: carryover.sourceMovementFingerprint,
      provenanceKind: 'fee-only-carryover',
      quantityBase: carryover.retainedQuantity,
      sourceQuantityBase: carryover.retainedQuantity,
      scopedTransaction,
      sourceTransactionId: carryover.sourceTransactionId,
      sourceMovementFingerprint: carryover.sourceMovementFingerprint,
    });
  }

  return ok(refs);
}

export async function buildSameAssetTransferFeeAdjustments(params: {
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
  fxProvider: IFxRateProvider;
  identityConfig: CanadaTaxInputContextBuildOptions;
  scopedTransactions: AccountingScopedTransaction[];
  validatedTransfers: ValidatedScopedTransferSet;
}): Promise<Result<CanadaFeeAdjustmentEvent[], Error>> {
  const { feeOnlyInternalCarryovers, fxProvider, identityConfig, scopedTransactions, validatedTransfers } = params;
  const refsResult = buildSameAssetFeeSourceRefs(
    scopedTransactions,
    validatedTransfers,
    feeOnlyInternalCarryovers,
    identityConfig
  );
  if (refsResult.isErr()) {
    return err(refsResult.error);
  }

  const refsByTransactionAndAsset = new Map<string, SameAssetFeeSourceRef[]>();
  for (const ref of refsResult.value) {
    const key = `${ref.scopedTransaction.tx.id}:${ref.assetId}`;
    const existingRefs = refsByTransactionAndAsset.get(key) ?? [];
    existingRefs.push(ref);
    refsByTransactionAndAsset.set(key, existingRefs);
  }

  const events: CanadaFeeAdjustmentEvent[] = [];

  for (const [key, refs] of refsByTransactionAndAsset.entries()) {
    const transaction = refs[0]!.scopedTransaction;
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
          `Same-asset fee allocation requires positive quantity bases for tx ${transaction.tx.id} asset ${refs[0]!.assetId}`
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
        new Date(transaction.tx.datetime),
        fxProvider,
        identityConfig,
        `tx:${transaction.tx.id}:${key}:${index}:same-asset-transfer-fee`
      );
      if (eventResult.isErr()) {
        return err(eventResult.error);
      }

      events.push(...eventResult.value);
    }
  }

  return ok(events);
}
