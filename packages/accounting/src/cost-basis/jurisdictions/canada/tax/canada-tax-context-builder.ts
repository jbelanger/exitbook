import { err, ok, type Result } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import { UsdConversionRateProvider } from '../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
} from '../../../standard/matching/build-cost-basis-scoped-transactions.js';
import type { ValidatedScopedTransferSet } from '../../../standard/matching/validated-scoped-transfer-links.js';

import { applyCarryoverSemantics } from './canada-tax-event-carryover.js';
import {
  applyGenericFeeAdjustments,
  buildSameAssetTransferFeeAdjustments,
  buildValidatedTransferTargetFeeAdjustments,
} from './canada-tax-event-fee-adjustments.js';
import { sortCanadaEvents } from './canada-tax-event-ordering.js';
import { projectCanadaMovementEvents } from './canada-tax-event-projection.js';
import type { CanadaTaxInputContext, CanadaTaxInputContextBuildOptions } from './canada-tax-types.js';

export async function buildCanadaTaxInputContext(params: {
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
  identityConfig: CanadaTaxInputContextBuildOptions;
  priceRuntime: IPriceProviderRuntime;
  scopedTransactions: AccountingScopedTransaction[];
  validatedTransfers: ValidatedScopedTransferSet;
}): Promise<Result<CanadaTaxInputContext, Error>> {
  const { feeOnlyInternalCarryovers, identityConfig, priceRuntime, scopedTransactions, validatedTransfers } = params;
  const usdConversionRateProvider = new UsdConversionRateProvider(priceRuntime);

  const projectedEventsResult = await projectCanadaMovementEvents({
    scopedTransactions,
    validatedTransfers,
    usdConversionRateProvider,
    identityConfig,
  });
  if (projectedEventsResult.isErr()) {
    return err(projectedEventsResult.error);
  }

  const carryoverEventsResult = await applyCarryoverSemantics({
    events: projectedEventsResult.value,
    scopedTransactions,
    feeOnlyInternalCarryovers,
    usdConversionRateProvider,
    identityConfig,
  });
  if (carryoverEventsResult.isErr()) {
    return err(carryoverEventsResult.error);
  }

  const finalizedEvents = carryoverEventsResult.value;

  const validatedTargetFeeEventsResult = await buildValidatedTransferTargetFeeAdjustments({
    scopedTransactions,
    validatedTransfers,
    usdConversionRateProvider,
    identityConfig,
  });
  if (validatedTargetFeeEventsResult.isErr()) {
    return err(validatedTargetFeeEventsResult.error);
  }

  const sameAssetTransferFeeEventsResult = await buildSameAssetTransferFeeAdjustments({
    scopedTransactions,
    validatedTransfers,
    feeOnlyInternalCarryovers,
    usdConversionRateProvider,
    identityConfig,
  });
  if (sameAssetTransferFeeEventsResult.isErr()) {
    return err(sameAssetTransferFeeEventsResult.error);
  }

  const genericFeeAdjustmentsResult = await applyGenericFeeAdjustments({
    events: finalizedEvents,
    scopedTransactions,
    usdConversionRateProvider,
    identityConfig,
    sameAssetTransferFeeEvents: sameAssetTransferFeeEventsResult.value,
  });
  if (genericFeeAdjustmentsResult.isErr()) {
    return err(genericFeeAdjustmentsResult.error);
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
