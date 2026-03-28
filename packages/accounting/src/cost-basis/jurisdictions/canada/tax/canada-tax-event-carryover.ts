import { err, ok, type Result } from '@exitbook/foundation';

import type { UsdConversionRateProviderLike } from '../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import { collectFiatFees } from '../../../standard/lots/lot-fee-utils.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
} from '../../../standard/matching/build-cost-basis-scoped-transactions.js';

import {
  buildAddToPoolCostAdjustmentEvents,
  buildEventIndex,
  buildMovementIndexes,
} from './canada-tax-event-stage-shared.js';
import { valueCollectedFiatFees } from './canada-tax-fee-utils.js';
import type {
  CanadaAcquisitionEvent,
  CanadaFeeAdjustmentEvent,
  CanadaTaxInputContextBuildOptions,
  CanadaTaxInputEvent,
  CanadaTransferInEvent,
} from './canada-tax-types.js';

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
  identityConfig: CanadaTaxInputContextBuildOptions;
  scopedTransactions: AccountingScopedTransaction[];
  usdConversionRateProvider: UsdConversionRateProviderLike;
}): Promise<Result<CanadaTaxInputEvent[], Error>> {
  const { events, feeOnlyInternalCarryovers, identityConfig, scopedTransactions, usdConversionRateProvider } = params;
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
        usdConversionRateProvider,
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
