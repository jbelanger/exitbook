import type { AssetMovement, Currency, FeeMovement, PriceAtTxTime } from '@exitbook/core';
import { err, isFiat, ok, parseDecimal, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';
import { collectFiatFees, extractCryptoFee } from '../lots/lot-fee-utils.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
  ScopedAssetMovement,
  ScopedFeeMovement,
} from '../matching/build-cost-basis-scoped-transactions.js';
import type {
  ValidatedScopedTransferLink,
  ValidatedScopedTransferSet,
} from '../matching/validated-scoped-transfer-links.js';
import { resolveTaxAssetIdentity } from '../shared/tax-asset-identity.js';
import type { TaxAssetIdentityPolicy } from '../shared/types.js';

import { buildCanadaTaxPropertyKey } from './canada-tax-identity-utils.js';
import type {
  CanadaAcquisitionEvent,
  CanadaDispositionEvent,
  CanadaFeeAdjustmentEvent,
  CanadaTaxInputContext,
  CanadaTaxInputEvent,
  CanadaTaxValuation,
  CanadaTransferInEvent,
  CanadaTransferOutEvent,
} from './canada-tax-types.js';

type CanadaMovementEvent =
  | CanadaAcquisitionEvent
  | CanadaDispositionEvent
  | CanadaTransferInEvent
  | CanadaTransferOutEvent;

interface CanadaPoolIdentity {
  assetIdentityKey: string;
  taxPropertyKey: string;
}

interface CanadaValuedFee {
  feeAssetIdentityKey?: string | undefined;
  feeAssetId: string;
  feeAssetSymbol: Currency;
  feeQuantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
  valuation: CanadaTaxValuation;
}

interface CollectedFiatFee {
  amount: Decimal;
  assetSymbol: string;
  date: string;
  priceAtTxTime?: PriceAtTxTime | undefined;
  txId: number;
}

interface SameAssetFeeSourceRef {
  assetIdentityKey: string;
  assetId: string;
  assetSymbol: Currency;
  feePriceAtTxTime?: PriceAtTxTime | undefined;
  linkId?: number | undefined;
  movementFingerprint?: string | undefined;
  provenanceKind: 'validated-link' | 'fee-only-carryover';
  quantityBase: Decimal;
  scopedTransaction: AccountingScopedTransaction;
  sourceTransactionId?: number | undefined;
  sourceMovementFingerprint?: string | undefined;
}

export interface CanadaTaxInputContextBuildOptions {
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy;
}

function normalizeDecimal(value: Decimal): Decimal {
  return value.abs().lt(parseDecimal('1e-18')) ? parseDecimal('0') : value;
}

function getEventPriority(kind: CanadaTaxInputEvent['kind']): number {
  switch (kind) {
    case 'transfer-out':
      return 0;
    case 'disposition':
      return 1;
    case 'acquisition':
      return 2;
    case 'transfer-in':
      return 3;
    case 'fee-adjustment':
      return 4;
  }
}

function sortCanadaEvents(events: CanadaTaxInputEvent[]): CanadaTaxInputEvent[] {
  return [...events].sort((left, right) => {
    const timestampDiff = left.timestamp.getTime() - right.timestamp.getTime();
    if (timestampDiff !== 0) return timestampDiff;

    const transactionDiff = left.transactionId - right.transactionId;
    if (transactionDiff !== 0) return transactionDiff;

    const priorityDiff = getEventPriority(left.kind) - getEventPriority(right.kind);
    if (priorityDiff !== 0) return priorityDiff;

    return left.eventId.localeCompare(right.eventId);
  });
}

async function buildCanadaTaxValuation(
  priceAtTxTime: PriceAtTxTime,
  quantity: Decimal,
  timestamp: Date,
  fxProvider: IFxRateProvider
): Promise<Result<CanadaTaxValuation, Error>> {
  const quotedPrice = priceAtTxTime.quotedPrice ?? priceAtTxTime.price;

  if (quotedPrice.currency === 'CAD') {
    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: quotedPrice.amount,
      totalValueCad: quotedPrice.amount.times(quantity),
      valuationSource: priceAtTxTime.quotedPrice ? 'quoted-price' : 'stored-price',
      fxRateToCad: undefined,
      fxSource: priceAtTxTime.fxSource,
      fxTimestamp: priceAtTxTime.fxTimestamp,
    });
  }

  if (priceAtTxTime.price.currency === 'CAD') {
    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: priceAtTxTime.price.amount,
      totalValueCad: priceAtTxTime.price.amount.times(quantity),
      valuationSource: 'stored-price',
      fxRateToCad: undefined,
      fxSource: priceAtTxTime.fxSource,
      fxTimestamp: priceAtTxTime.fxTimestamp,
    });
  }

  if (priceAtTxTime.price.currency === 'USD') {
    const usdToCadResult = await fxProvider.getRateFromUSD('CAD' as Currency, timestamp);
    if (usdToCadResult.isErr()) {
      return err(
        new Error(`Failed to convert USD price to CAD at ${timestamp.toISOString()}: ${usdToCadResult.error.message}`)
      );
    }

    const usdToCad = usdToCadResult.value;

    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: priceAtTxTime.price.amount.times(usdToCad.rate),
      totalValueCad: priceAtTxTime.price.amount.times(usdToCad.rate).times(quantity),
      valuationSource: 'usd-to-cad-fx',
      fxRateToCad: usdToCad.rate,
      fxSource: usdToCad.source,
      fxTimestamp: usdToCad.fetchedAt,
    });
  }

  if (isFiat(priceAtTxTime.price.currency)) {
    const toUsdResult = await fxProvider.getRateToUSD(priceAtTxTime.price.currency, timestamp);
    if (toUsdResult.isErr()) {
      return err(
        new Error(
          `Failed to normalize ${priceAtTxTime.price.currency} price to USD at ${timestamp.toISOString()}: ` +
            toUsdResult.error.message
        )
      );
    }

    const usdToCadResult = await fxProvider.getRateFromUSD('CAD' as Currency, timestamp);
    if (usdToCadResult.isErr()) {
      return err(
        new Error(`Failed to convert USD price to CAD at ${timestamp.toISOString()}: ${usdToCadResult.error.message}`)
      );
    }

    const cadPerUnit = priceAtTxTime.price.amount.times(toUsdResult.value.rate).times(usdToCadResult.value.rate);
    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: cadPerUnit,
      totalValueCad: cadPerUnit.times(quantity),
      valuationSource: 'fiat-to-cad-fx',
      fxRateToCad: toUsdResult.value.rate.times(usdToCadResult.value.rate),
      fxSource: `${toUsdResult.value.source}+${usdToCadResult.value.source}`,
      fxTimestamp: usdToCadResult.value.fetchedAt,
    });
  }

  return err(
    new Error(`Canada tax valuation requires fiat or USD price data, received ${priceAtTxTime.price.currency}`)
  );
}

function resolvePoolIdentity(
  item: AssetMovement | FeeMovement,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Result<CanadaPoolIdentity, Error> {
  if (isFiat(item.assetSymbol)) {
    return err(new Error(`Canada pool identity requires a non-fiat asset, received ${item.assetSymbol}`));
  }

  const assetIdentityResult = resolveTaxAssetIdentity(
    {
      assetId: item.assetId,
      assetSymbol: item.assetSymbol,
    },
    taxAssetIdentityPolicy
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

function getTransferComparableQuantity(movement: AssetMovement): Decimal {
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

function createFiatIdentityPrice(assetSymbol: Currency, timestamp: Date): PriceAtTxTime {
  return {
    price: { amount: parseDecimal('1'), currency: assetSymbol },
    quotedPrice: { amount: parseDecimal('1'), currency: assetSymbol },
    source: 'fiat-identity',
    fetchedAt: timestamp,
    granularity: 'exact',
  };
}

async function buildValuedFee(
  fee: {
    amount: Decimal;
    assetId: string;
    assetSymbol: Currency;
    priceAtTxTime?: PriceAtTxTime | undefined;
  },
  timestamp: Date,
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<CanadaValuedFee, Error>> {
  if (!fee.priceAtTxTime && !isFiat(fee.assetSymbol)) {
    return err(new Error(`Missing priceAtTxTime for fee ${fee.assetSymbol} at ${timestamp.toISOString()}`));
  }

  let feeAssetIdentityKey: string | undefined;
  if (!isFiat(fee.assetSymbol)) {
    const feeIdentityResult = resolveTaxAssetIdentity(
      {
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol,
      },
      taxAssetIdentityPolicy
    );
    if (feeIdentityResult.isErr()) {
      return err(
        new Error(
          `Failed to resolve tax identity for fee ${fee.assetSymbol} (${fee.assetId}) at ${timestamp.toISOString()}: ` +
            feeIdentityResult.error.message
        )
      );
    }

    feeAssetIdentityKey = feeIdentityResult.value.identityKey;
  }

  const valuationResult = await buildCanadaTaxValuation(
    fee.priceAtTxTime ?? createFiatIdentityPrice(fee.assetSymbol, timestamp),
    fee.amount,
    timestamp,
    fxProvider
  );
  if (valuationResult.isErr()) {
    return err(valuationResult.error);
  }

  return ok({
    feeAssetIdentityKey,
    feeAssetId: fee.assetId,
    feeAssetSymbol: fee.assetSymbol,
    feeQuantity: fee.amount,
    priceAtTxTime: fee.priceAtTxTime,
    valuation: valuationResult.value,
  });
}

async function valueScopedFees(
  fees: ScopedFeeMovement[],
  timestamp: Date,
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<CanadaValuedFee[], Error>> {
  const valuedFees: CanadaValuedFee[] = [];

  for (const fee of fees) {
    const valuedFeeResult = await buildValuedFee(
      {
        amount: fee.amount,
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol,
        priceAtTxTime: fee.priceAtTxTime,
      },
      timestamp,
      fxProvider,
      taxAssetIdentityPolicy
    );
    if (valuedFeeResult.isErr()) {
      return err(valuedFeeResult.error);
    }

    valuedFees.push(valuedFeeResult.value);
  }

  return ok(valuedFees);
}

async function valueCollectedFiatFees(
  fees: CollectedFiatFee[],
  timestamp: Date,
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<CanadaValuedFee[], Error>> {
  const valuedFees: CanadaValuedFee[] = [];

  for (const fee of fees) {
    const valuedFeeResult = await buildValuedFee(
      {
        amount: fee.amount,
        assetId: `fiat:${fee.assetSymbol.toLowerCase()}`,
        assetSymbol: fee.assetSymbol as Currency,
        priceAtTxTime: fee.priceAtTxTime,
      },
      timestamp,
      fxProvider,
      taxAssetIdentityPolicy
    );
    if (valuedFeeResult.isErr()) {
      return err(valuedFeeResult.error);
    }

    valuedFees.push(valuedFeeResult.value);
  }

  return ok(valuedFees);
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
  inflowsByFingerprint: Map<string, { movement: ScopedAssetMovement; scopedTransaction: AccountingScopedTransaction }>;
  outflowsByFingerprint: Map<string, { movement: ScopedAssetMovement; scopedTransaction: AccountingScopedTransaction }>;
  scopedByTxId: Map<number, AccountingScopedTransaction>;
} {
  const inflowsByFingerprint = new Map<
    string,
    { movement: ScopedAssetMovement; scopedTransaction: AccountingScopedTransaction }
  >();
  const outflowsByFingerprint = new Map<
    string,
    { movement: ScopedAssetMovement; scopedTransaction: AccountingScopedTransaction }
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
  movement: ScopedAssetMovement,
  quantity: Decimal,
  kind: CanadaMovementEvent['kind'],
  eventId: string,
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy,
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

  const identityResult = resolvePoolIdentity(movement, taxAssetIdentityPolicy);
  if (identityResult.isErr()) {
    return err(identityResult.error);
  }

  const valuationResult = await buildCanadaTaxValuation(
    movement.priceAtTxTime,
    quantity,
    new Date(scopedTransaction.tx.datetime),
    fxProvider
  );
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
  movement: ScopedAssetMovement,
  direction: 'inflow' | 'outflow',
  validatedLinks: ValidatedScopedTransferLink[],
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
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
      taxAssetIdentityPolicy,
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
      taxAssetIdentityPolicy,
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
      taxAssetIdentityPolicy,
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

async function projectCanadaMovementEvents(
  scopedTransactions: AccountingScopedTransaction[],
  validatedTransfers: ValidatedScopedTransferSet,
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<CanadaMovementEvent[], Error>> {
  const events: CanadaMovementEvent[] = [];

  for (const scopedTransaction of scopedTransactions) {
    for (const inflow of scopedTransaction.movements.inflows) {
      const inflowEventsResult = await projectTransferAwareMovementEvents(
        scopedTransaction,
        inflow,
        'inflow',
        validatedTransfers.byTargetMovementFingerprint.get(inflow.movementFingerprint) ?? [],
        fxProvider,
        taxAssetIdentityPolicy
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
        taxAssetIdentityPolicy
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
  poolMovement: ScopedAssetMovement,
  valuedFees: CanadaValuedFee[],
  timestamp: Date,
  transactionId: number,
  eventIdPrefix: string,
  relatedEventId: string,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy,
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

  const identityResult = resolvePoolIdentity(poolMovement, taxAssetIdentityPolicy);
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
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy,
  eventId: string
): Promise<Result<CanadaFeeAdjustmentEvent | undefined, Error>> {
  if (feeAmount.lte(0)) {
    return ok(undefined);
  }

  const valuedFeeResult = await buildValuedFee(
    {
      amount: feeAmount,
      assetId: ref.assetId,
      assetSymbol: ref.assetSymbol,
      priceAtTxTime: feePriceAtTxTime,
    },
    timestamp,
    fxProvider,
    taxAssetIdentityPolicy
  );
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
    linkId: ref.linkId,
    sourceTransactionId: ref.sourceTransactionId,
    sourceMovementFingerprint: ref.sourceMovementFingerprint ?? ref.movementFingerprint,
    relatedEventId: ref.movementFingerprint ? `movement:${ref.movementFingerprint}` : undefined,
  });
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

async function applyCarryoverSemantics(
  events: CanadaTaxInputEvent[],
  scopedTransactions: AccountingScopedTransaction[],
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<CanadaTaxInputEvent[], Error>> {
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
        taxAssetIdentityPolicy
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
        taxAssetIdentityPolicy,
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

async function applyGenericFeeAdjustments(
  events: CanadaTaxInputEvent[],
  scopedTransactions: AccountingScopedTransaction[],
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<void, Error>> {
  for (const scopedTransaction of scopedTransactions) {
    const timestamp = new Date(scopedTransaction.tx.datetime);
    const valuedFeesResult = await valueScopedFees(
      scopedTransaction.fees,
      timestamp,
      fxProvider,
      taxAssetIdentityPolicy
    );
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

      for (const [index, event] of dispositionEvents.entries()) {
        const allocatedCad =
          index === dispositionEvents.length - 1
            ? normalizeDecimal(
                totalDispositionFeeCad.minus(
                  dispositionEvents
                    .slice(0, index)
                    .reduce(
                      (sum, priorEvent) =>
                        sum.plus(allocateCadAcrossEvents(totalDispositionFeeCad, priorEvent, dispositionEvents)),
                      parseDecimal('0')
                    )
                )
              )
            : normalizeDecimal(allocateCadAcrossEvents(totalDispositionFeeCad, event, dispositionEvents));

        if (allocatedCad.gt(0)) {
          event.proceedsReductionCad = (event.proceedsReductionCad ?? parseDecimal('0')).plus(allocatedCad);
        }
      }
    }
  }

  return ok(undefined);
}

async function buildValidatedTransferTargetFeeAdjustments(
  scopedTransactions: AccountingScopedTransaction[],
  validatedTransfers: ValidatedScopedTransferSet,
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<CanadaFeeAdjustmentEvent[], Error>> {
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
      taxAssetIdentityPolicy
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
      taxAssetIdentityPolicy,
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
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Result<SameAssetFeeSourceRef[], Error> {
  const { outflowsByFingerprint, scopedByTxId } = buildMovementIndexes(scopedTransactions);
  const refs: SameAssetFeeSourceRef[] = [];

  for (const [sourceMovementFingerprint, validatedLinks] of validatedTransfers.bySourceMovementFingerprint.entries()) {
    if (validatedLinks.length === 0) continue;

    const outflowRef = outflowsByFingerprint.get(sourceMovementFingerprint);
    if (!outflowRef) {
      return err(new Error(`Validated transfer source movement ${sourceMovementFingerprint} not found`));
    }

    const identityResult = resolvePoolIdentity(outflowRef.movement, taxAssetIdentityPolicy);
    if (identityResult.isErr()) {
      return err(identityResult.error);
    }

    const cryptoFeeResult = extractCryptoFee(outflowRef.scopedTransaction, outflowRef.movement.assetId);
    if (cryptoFeeResult.isErr()) {
      return err(cryptoFeeResult.error);
    }

    refs.push({
      assetIdentityKey: identityResult.value.assetIdentityKey,
      assetId: outflowRef.movement.assetId,
      assetSymbol: outflowRef.movement.assetSymbol,
      feePriceAtTxTime: cryptoFeeResult.value.priceAtTxTime,
      linkId: validatedLinks[0]!.link.id,
      movementFingerprint: sourceMovementFingerprint,
      provenanceKind: 'validated-link',
      quantityBase: validatedLinks[0]!.sourceMovementAmount,
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
      taxAssetIdentityPolicy
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
      scopedTransaction,
      sourceTransactionId: carryover.sourceTransactionId,
      sourceMovementFingerprint: carryover.sourceMovementFingerprint,
    });
  }

  return ok(refs);
}

async function buildSameAssetTransferFeeAdjustments(
  scopedTransactions: AccountingScopedTransaction[],
  validatedTransfers: ValidatedScopedTransferSet,
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  fxProvider: IFxRateProvider,
  taxAssetIdentityPolicy: TaxAssetIdentityPolicy
): Promise<Result<CanadaFeeAdjustmentEvent[], Error>> {
  const refsResult = buildSameAssetFeeSourceRefs(
    scopedTransactions,
    validatedTransfers,
    feeOnlyInternalCarryovers,
    taxAssetIdentityPolicy
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

    const totalQuantityBase = refs.reduce((sum, ref) => sum.plus(ref.quantityBase), parseDecimal('0'));
    let allocatedQuantitySoFar = parseDecimal('0');

    for (const [index, ref] of refs.entries()) {
      const allocatedFeeQuantity =
        index === refs.length - 1
          ? normalizeDecimal(cryptoFee.amount.minus(allocatedQuantitySoFar))
          : normalizeDecimal(cryptoFee.amount.times(ref.quantityBase).dividedBy(totalQuantityBase));
      allocatedQuantitySoFar = allocatedQuantitySoFar.plus(allocatedFeeQuantity);

      const eventResult = await buildSameAssetTransferFeeAdjustmentEvent(
        ref,
        allocatedFeeQuantity,
        cryptoFee.priceAtTxTime ?? ref.feePriceAtTxTime,
        new Date(transaction.tx.datetime),
        fxProvider,
        taxAssetIdentityPolicy,
        `tx:${transaction.tx.id}:${key}:${index}:same-asset-transfer-fee`
      );
      if (eventResult.isErr()) {
        return err(eventResult.error);
      }

      if (eventResult.value) {
        events.push(eventResult.value);
      }
    }
  }

  return ok(events);
}

export async function buildCanadaTaxInputContext(
  scopedTransactions: AccountingScopedTransaction[],
  validatedTransfers: ValidatedScopedTransferSet,
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  fxProvider: IFxRateProvider,
  options: CanadaTaxInputContextBuildOptions
): Promise<Result<CanadaTaxInputContext, Error>> {
  const projectedEventsResult = await projectCanadaMovementEvents(
    scopedTransactions,
    validatedTransfers,
    fxProvider,
    options.taxAssetIdentityPolicy
  );
  if (projectedEventsResult.isErr()) {
    return err(projectedEventsResult.error);
  }

  const carryoverEventsResult = await applyCarryoverSemantics(
    projectedEventsResult.value,
    scopedTransactions,
    feeOnlyInternalCarryovers,
    fxProvider,
    options.taxAssetIdentityPolicy
  );
  if (carryoverEventsResult.isErr()) {
    return err(carryoverEventsResult.error);
  }

  const finalizedEvents = carryoverEventsResult.value;

  const genericFeeAdjustmentsResult = await applyGenericFeeAdjustments(
    finalizedEvents,
    scopedTransactions,
    fxProvider,
    options.taxAssetIdentityPolicy
  );
  if (genericFeeAdjustmentsResult.isErr()) {
    return err(genericFeeAdjustmentsResult.error);
  }

  const validatedTargetFeeEventsResult = await buildValidatedTransferTargetFeeAdjustments(
    scopedTransactions,
    validatedTransfers,
    fxProvider,
    options.taxAssetIdentityPolicy
  );
  if (validatedTargetFeeEventsResult.isErr()) {
    return err(validatedTargetFeeEventsResult.error);
  }

  const sameAssetTransferFeeEventsResult = await buildSameAssetTransferFeeAdjustments(
    scopedTransactions,
    validatedTransfers,
    feeOnlyInternalCarryovers,
    fxProvider,
    options.taxAssetIdentityPolicy
  );
  if (sameAssetTransferFeeEventsResult.isErr()) {
    return err(sameAssetTransferFeeEventsResult.error);
  }

  return ok({
    taxCurrency: 'CAD',
    scopedTransactionIds: scopedTransactions.map((scopedTransaction) => scopedTransaction.tx.id),
    validatedTransferLinkIds: validatedTransfers.links.map((validatedLink) => validatedLink.link.id),
    feeOnlyInternalCarryoverSourceTransactionIds: feeOnlyInternalCarryovers.map(
      (carryover) => carryover.sourceTransactionId
    ),
    inputEvents: sortCanadaEvents([
      ...finalizedEvents,
      ...validatedTargetFeeEventsResult.value,
      ...sameAssetTransferFeeEventsResult.value,
    ]),
  });
}
