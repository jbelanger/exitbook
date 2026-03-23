import { err, ok, type Result } from '@exitbook/foundation';

import type { IFxRateProvider } from '../../../../price-enrichment/shared/types.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
} from '../../../standard/matching/build-cost-basis-scoped-transactions.js';
import type { ValidatedScopedTransferSet } from '../../../standard/matching/validated-scoped-transfer-links.js';

import {
  applyCarryoverSemantics,
  applyGenericFeeAdjustments,
  buildSameAssetTransferFeeAdjustments,
  buildValidatedTransferTargetFeeAdjustments,
  projectCanadaMovementEvents,
} from './canada-tax-event-builders.js';
import { sortCanadaEvents } from './canada-tax-event-ordering.js';
import type { CanadaTaxInputContext, CanadaTaxInputContextBuildOptions } from './canada-tax-types.js';

export async function buildCanadaTaxInputContext(params: {
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
  fxProvider: IFxRateProvider;
  identityConfig: CanadaTaxInputContextBuildOptions;
  scopedTransactions: AccountingScopedTransaction[];
  validatedTransfers: ValidatedScopedTransferSet;
}): Promise<Result<CanadaTaxInputContext, Error>> {
  const { feeOnlyInternalCarryovers, fxProvider, identityConfig, scopedTransactions, validatedTransfers } = params;

  const projectedEventsResult = await projectCanadaMovementEvents({
    scopedTransactions,
    validatedTransfers,
    fxProvider,
    identityConfig,
  });
  if (projectedEventsResult.isErr()) {
    return err(projectedEventsResult.error);
  }

  const carryoverEventsResult = await applyCarryoverSemantics({
    events: projectedEventsResult.value,
    scopedTransactions,
    feeOnlyInternalCarryovers,
    fxProvider,
    identityConfig,
  });
  if (carryoverEventsResult.isErr()) {
    return err(carryoverEventsResult.error);
  }

  const finalizedEvents = carryoverEventsResult.value;

  const validatedTargetFeeEventsResult = await buildValidatedTransferTargetFeeAdjustments({
    scopedTransactions,
    validatedTransfers,
    fxProvider,
    identityConfig,
  });
  if (validatedTargetFeeEventsResult.isErr()) {
    return err(validatedTargetFeeEventsResult.error);
  }

  const sameAssetTransferFeeEventsResult = await buildSameAssetTransferFeeAdjustments({
    scopedTransactions,
    validatedTransfers,
    feeOnlyInternalCarryovers,
    fxProvider,
    identityConfig,
  });
  if (sameAssetTransferFeeEventsResult.isErr()) {
    return err(sameAssetTransferFeeEventsResult.error);
  }

  const genericFeeAdjustmentsResult = await applyGenericFeeAdjustments({
    events: finalizedEvents,
    scopedTransactions,
    fxProvider,
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
