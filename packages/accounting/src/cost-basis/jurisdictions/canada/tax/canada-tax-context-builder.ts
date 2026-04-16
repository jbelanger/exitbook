import { resultDoAsync, type Result } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { AccountingModelBuildResult, ValidatedTransferSet } from '../../../../accounting-model.js';
import { UsdConversionRateProvider } from '../../../../price-enrichment/fx/usd-conversion-rate-provider.js';

import { buildCanadaAccountingModelContext } from './canada-accounting-model-context.js';
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
  accountingModel: AccountingModelBuildResult;
  identityConfig: CanadaTaxInputContextBuildOptions;
  priceRuntime: IPriceProviderRuntime;
  validatedTransfers: ValidatedTransferSet;
}): Promise<Result<CanadaTaxInputContext, Error>> {
  return resultDoAsync(async function* () {
    const { accountingModel, identityConfig, priceRuntime, validatedTransfers } = params;
    const usdConversionRateProvider = new UsdConversionRateProvider(priceRuntime);
    const canadaAccountingContext = yield* buildCanadaAccountingModelContext(accountingModel);
    const effectiveIdentityConfig = yield* buildTransferAwareIdentityConfig(identityConfig, validatedTransfers);

    const projectedEvents = yield* await projectCanadaMovementEvents({
      accountingTransactionViews: accountingModel.accountingTransactionViews,
      validatedTransfers,
      usdConversionRateProvider,
      identityConfig: effectiveIdentityConfig,
    });

    const finalizedEvents = yield* await applyCarryoverSemantics({
      canadaAccountingContext,
      events: projectedEvents,
      usdConversionRateProvider,
      identityConfig: effectiveIdentityConfig,
    });

    const validatedTargetFeeEvents = yield* await buildValidatedTransferTargetFeeAdjustments({
      canadaAccountingContext,
      validatedTransfers,
      usdConversionRateProvider,
      identityConfig: effectiveIdentityConfig,
    });

    const sameAssetTransferFeeEvents = yield* await buildSameAssetTransferFeeAdjustments({
      canadaAccountingContext,
      validatedTransfers,
      usdConversionRateProvider,
      identityConfig: effectiveIdentityConfig,
    });

    yield* await applyGenericFeeAdjustments({
      canadaAccountingContext,
      events: finalizedEvents,
      usdConversionRateProvider,
      identityConfig: effectiveIdentityConfig,
      sameAssetTransferFeeEvents,
    });

    return {
      taxCurrency: 'CAD',
      inputTransactionIds: accountingModel.accountingTransactionViews.map(
        (transactionView) => transactionView.processedTransaction.id
      ),
      validatedTransferLinkIds: validatedTransfers.links.map((validatedLink) => validatedLink.link.id),
      internalTransferCarryoverSourceTransactionIds: canadaAccountingContext.resolvedInternalTransferCarryovers.map(
        (carryover) => carryover.source.processedTransaction.id
      ),
      inputEvents: sortCanadaEvents([...finalizedEvents, ...validatedTargetFeeEvents, ...sameAssetTransferFeeEvents]),
    };
  });
}
