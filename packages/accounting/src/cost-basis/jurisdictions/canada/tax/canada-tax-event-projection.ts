import type { AssetMovement } from '@exitbook/core';
import { getExplainedTargetResidual, getMovementRole } from '@exitbook/core';
import { err, isFiat, ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { UsdConversionRateProviderLike } from '../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import type { AccountingScopedTransaction } from '../../../standard/matching/build-cost-basis-scoped-transactions.js';
import type {
  ValidatedScopedTransferLink,
  ValidatedScopedTransferSet,
} from '../../../standard/matching/validated-scoped-transfer-links.js';

import { resolvePoolIdentity, type CanadaMovementEvent } from './canada-tax-event-stage-shared.js';
import type { CanadaAcquisitionEvent, CanadaTaxInputContextBuildOptions } from './canada-tax-types.js';
import { buildCanadaTaxValuation, normalizeDecimal } from './canada-tax-valuation.js';

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

async function buildMovementEvent(
  scopedTransaction: AccountingScopedTransaction,
  movement: AssetMovement,
  quantity: Decimal,
  kind: CanadaMovementEvent['kind'],
  eventId: string,
  usdConversionRateProvider: UsdConversionRateProviderLike,
  identityConfig: CanadaTaxInputContextBuildOptions,
  provenance: {
    linkId?: number | undefined;
    provenanceKind: 'scoped-movement' | 'validated-link';
    sourceMovementFingerprint?: string | undefined;
    targetMovementFingerprint?: string | undefined;
  },
  options?: {
    incomeCategory?: CanadaAcquisitionEvent['incomeCategory'] | undefined;
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
    usdConversionRateProvider,
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
        ...(options?.incomeCategory !== undefined ? { incomeCategory: options.incomeCategory } : {}),
      });
    case 'disposition':
      return ok({ ...baseEvent, kind, quantity });
    case 'transfer-in':
      return ok({ ...baseEvent, kind, quantity });
    case 'transfer-out':
      return ok({ ...baseEvent, kind, quantity });
  }
}

function getMovementIncomeCategory(movement: AssetMovement): CanadaAcquisitionEvent['incomeCategory'] | undefined {
  return getMovementRole(movement) === 'staking_reward' ? 'staking_reward' : undefined;
}

function getExplainedResidualIncomeCategory(
  links: readonly ValidatedScopedTransferLink[],
  residualQuantity: Decimal
): CanadaAcquisitionEvent['incomeCategory'] | undefined {
  const explainedResidual = getExplainedTargetResidual(links.map((validatedLink) => validatedLink.link));
  if (!explainedResidual || !explainedResidual.amount.eq(residualQuantity)) {
    return undefined;
  }

  switch (explainedResidual.role) {
    case 'staking_reward':
      return 'staking_reward';
    default:
      return undefined;
  }
}

async function projectTransferAwareMovementEvents(
  scopedTransaction: AccountingScopedTransaction,
  movement: AssetMovement,
  direction: 'inflow' | 'outflow',
  validatedLinks: ValidatedScopedTransferLink[],
  usdConversionRateProvider: UsdConversionRateProviderLike,
  identityConfig: CanadaTaxInputContextBuildOptions
): Promise<Result<CanadaMovementEvent[], Error>> {
  const sortedLinks = sortValidatedLinks(validatedLinks);
  const transferEventKind = direction === 'inflow' ? 'transfer-in' : 'transfer-out';
  const residualEventKind = direction === 'inflow' ? 'acquisition' : 'disposition';

  if (sortedLinks.length === 0) {
    const incomeCategory =
      direction === 'inflow' && residualEventKind === 'acquisition' ? getMovementIncomeCategory(movement) : undefined;
    const directEventResult = await buildMovementEvent(
      scopedTransaction,
      movement,
      movement.grossAmount,
      residualEventKind,
      `tx:${scopedTransaction.tx.id}:${residualEventKind}:${movement.movementFingerprint}:residual`,
      usdConversionRateProvider,
      identityConfig,
      { provenanceKind: 'scoped-movement' },
      { incomeCategory }
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
      usdConversionRateProvider,
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
    const incomeCategory =
      direction === 'inflow' && residualEventKind === 'acquisition'
        ? (getExplainedResidualIncomeCategory(sortedLinks, residualQuantityResult.value) ??
          getMovementIncomeCategory(movement))
        : undefined;
    const residualEventResult = await buildMovementEvent(
      scopedTransaction,
      movement,
      residualQuantityResult.value,
      residualEventKind,
      `tx:${scopedTransaction.tx.id}:${residualEventKind}:${movement.movementFingerprint}:residual`,
      usdConversionRateProvider,
      identityConfig,
      { provenanceKind: 'scoped-movement' },
      { incomeCategory }
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
  identityConfig: CanadaTaxInputContextBuildOptions;
  scopedTransactions: AccountingScopedTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
  validatedTransfers: ValidatedScopedTransferSet;
}): Promise<Result<CanadaMovementEvent[], Error>> {
  const { identityConfig, scopedTransactions, usdConversionRateProvider, validatedTransfers } = params;
  const events: CanadaMovementEvent[] = [];

  for (const scopedTransaction of scopedTransactions) {
    for (const inflow of scopedTransaction.movements.inflows) {
      const inflowEventsResult = await projectTransferAwareMovementEvents(
        scopedTransaction,
        inflow,
        'inflow',
        validatedTransfers.byTargetMovementFingerprint.get(inflow.movementFingerprint) ?? [],
        usdConversionRateProvider,
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
        usdConversionRateProvider,
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
