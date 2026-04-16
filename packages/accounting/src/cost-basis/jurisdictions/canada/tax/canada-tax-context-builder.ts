import { err, ok, type Result } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { AccountingLayerBuildResult, ValidatedTransferSet } from '../../../../accounting-layer.js';
import { UsdConversionRateProvider } from '../../../../price-enrichment/fx/usd-conversion-rate-provider.js';

import { buildCanadaAccountingLayerContext } from './canada-accounting-layer-context.js';
import { applyCarryoverSemantics } from './canada-tax-event-carryover.js';
import {
  applyGenericFeeAdjustments,
  buildSameAssetTransferFeeAdjustments,
  buildValidatedTransferTargetFeeAdjustments,
} from './canada-tax-event-fee-adjustments.js';
import { sortCanadaEvents } from './canada-tax-event-ordering.js';
import { projectCanadaMovementEvents } from './canada-tax-event-projection.js';
import { buildTransferAwareIdentityConfig } from './canada-tax-identity-overrides.js';
import type { CanadaTaxInputContext, CanadaTaxInputContextBuildOptions } from './canada-tax-types.js';

export async function buildCanadaTaxInputContext(params: {
  accountingLayer: AccountingLayerBuildResult;
  identityConfig: CanadaTaxInputContextBuildOptions;
  priceRuntime: IPriceProviderRuntime;
  validatedTransfers: ValidatedTransferSet;
}): Promise<Result<CanadaTaxInputContext, Error>> {
  const { accountingLayer, identityConfig, priceRuntime, validatedTransfers } = params;
  const usdConversionRateProvider = new UsdConversionRateProvider(priceRuntime);
  const canadaAccountingContextResult = buildCanadaAccountingLayerContext(accountingLayer);
  if (canadaAccountingContextResult.isErr()) {
    return err(canadaAccountingContextResult.error);
  }
  const canadaAccountingContext = canadaAccountingContextResult.value;
  const effectiveIdentityConfigResult = buildTransferAwareIdentityConfig(identityConfig, validatedTransfers);
  if (effectiveIdentityConfigResult.isErr()) {
    return err(effectiveIdentityConfigResult.error);
  }
  const effectiveIdentityConfig = effectiveIdentityConfigResult.value;

  const projectedEventsResult = await projectCanadaMovementEvents({
    accountingTransactionViews: accountingLayer.accountingTransactionViews,
    validatedTransfers,
    usdConversionRateProvider,
    identityConfig: effectiveIdentityConfig,
  });
  if (projectedEventsResult.isErr()) {
    return err(projectedEventsResult.error);
  }

  const carryoverEventsResult = await applyCarryoverSemantics({
    canadaAccountingContext,
    events: projectedEventsResult.value,
    usdConversionRateProvider,
    identityConfig: effectiveIdentityConfig,
  });
  if (carryoverEventsResult.isErr()) {
    return err(carryoverEventsResult.error);
  }

  const finalizedEvents = carryoverEventsResult.value;

  const validatedTargetFeeEventsResult = await buildValidatedTransferTargetFeeAdjustments({
    canadaAccountingContext,
    validatedTransfers,
    usdConversionRateProvider,
    identityConfig: effectiveIdentityConfig,
  });
  if (validatedTargetFeeEventsResult.isErr()) {
    return err(validatedTargetFeeEventsResult.error);
  }

  const sameAssetTransferFeeEventsResult = await buildSameAssetTransferFeeAdjustments({
    canadaAccountingContext,
    validatedTransfers,
    usdConversionRateProvider,
    identityConfig: effectiveIdentityConfig,
  });
  if (sameAssetTransferFeeEventsResult.isErr()) {
    return err(sameAssetTransferFeeEventsResult.error);
  }

  const genericFeeAdjustmentsResult = await applyGenericFeeAdjustments({
    canadaAccountingContext,
    events: finalizedEvents,
    usdConversionRateProvider,
    identityConfig: effectiveIdentityConfig,
    sameAssetTransferFeeEvents: sameAssetTransferFeeEventsResult.value,
  });
  if (genericFeeAdjustmentsResult.isErr()) {
    return err(genericFeeAdjustmentsResult.error);
  }

  return ok({
    taxCurrency: 'CAD',
    inputTransactionIds: accountingLayer.accountingTransactionViews.map(
      (transactionView) => transactionView.processedTransaction.id
    ),
    validatedTransferLinkIds: validatedTransfers.links.map((validatedLink) => validatedLink.link.id),
    internalTransferCarryoverSourceTransactionIds: canadaAccountingContext.resolvedInternalTransferCarryovers.map(
      (carryover) => carryover.source.processedTransaction.id
    ),
    inputEvents: sortCanadaEvents([
      ...finalizedEvents,
      ...validatedTargetFeeEventsResult.value,
      ...sameAssetTransferFeeEventsResult.value,
    ]),
  });
}
