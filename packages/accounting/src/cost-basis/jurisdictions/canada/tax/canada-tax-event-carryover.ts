import { err, ok, type Result } from '@exitbook/foundation';

import type { UsdConversionRateProviderLike } from '../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import { collectFiatFees } from '../../../standard/lots/lot-fee-utils.js';

import type { CanadaAccountingModelContext } from './canada-accounting-model-context.js';
import { buildAddToPoolCostAdjustmentEvents, buildEventIndex } from './canada-tax-event-stage-shared.js';
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
  sourceTransactionId: number,
  sourceMovementFingerprint: string,
  targetMovementFingerprint: string
): CanadaTransferInEvent {
  return {
    eventId: `carryover:${sourceTransactionId}:${targetMovementFingerprint}:transfer-in`,
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
    provenanceKind: 'internal-transfer-carryover',
    sourceTransactionId,
    sourceMovementFingerprint,
    targetMovementFingerprint,
  };
}

export async function applyCarryoverSemantics(params: {
  canadaAccountingContext: CanadaAccountingModelContext;
  events: CanadaTaxInputEvent[];
  identityConfig: CanadaTaxInputContextBuildOptions;
  usdConversionRateProvider: UsdConversionRateProviderLike;
}): Promise<Result<CanadaTaxInputEvent[], Error>> {
  const { canadaAccountingContext, events, identityConfig, usdConversionRateProvider } = params;
  const { byMovementFingerprint } = buildEventIndex(events);
  const finalizedEvents = [...events];
  const feeAdjustmentEvents: CanadaFeeAdjustmentEvent[] = [];

  for (const resolvedCarryover of canadaAccountingContext.resolvedInternalTransferCarryovers) {
    const sourceTransaction = resolvedCarryover.source.processedTransaction;

    for (const target of resolvedCarryover.targets) {
      const targetTransactionView = target.target.transactionView;
      if (!targetTransactionView) {
        return err(
          new Error(
            `Internal-transfer carryover target ${target.target.entry.entryFingerprint} must resolve to an accounting transaction view`
          )
        );
      }

      const indexedEvents = byMovementFingerprint.get(target.target.movement.movementFingerprint) ?? [];
      const acquisitionEvent = indexedEvents.find((event) => event.kind === 'acquisition');
      if (!acquisitionEvent) {
        const conflictingEvent = indexedEvents[0];
        if (conflictingEvent) {
          return err(
            new Error(
              `Movement ${target.target.movement.movementFingerprint} is already classified as ${conflictingEvent.kind} ` +
                `and cannot also be an internal-transfer carryover target`
            )
          );
        }

        return err(
          new Error(
            `Internal-transfer carryover target movement ${target.target.movement.movementFingerprint} was not projected as acquisition`
          )
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
        sourceTransaction.id,
        resolvedCarryover.source.movement.movementFingerprint,
        target.target.movement.movementFingerprint
      );

      const sourceFraction = target.binding.quantity.dividedBy(resolvedCarryover.source.entry.quantity);
      const targetFraction = target.binding.quantity.dividedBy(target.target.entry.quantity);
      const fiatFeesResult = collectFiatFees(sourceTransaction, targetTransactionView, {
        sourceFraction,
        targetFraction,
      });
      if (fiatFeesResult.isErr()) {
        return err(fiatFeesResult.error);
      }

      const valuedFeesResult = await valueCollectedFiatFees(
        fiatFeesResult.value,
        new Date(targetTransactionView.processedTransaction.datetime),
        usdConversionRateProvider,
        identityConfig
      );
      if (valuedFeesResult.isErr()) {
        return err(valuedFeesResult.error);
      }

      const feeAdjustmentEventsResult = buildAddToPoolCostAdjustmentEvents(
        target.target.movement,
        valuedFeesResult.value,
        new Date(targetTransactionView.processedTransaction.datetime),
        targetTransactionView.processedTransaction.id,
        `carryover:${sourceTransaction.id}:${target.target.movement.movementFingerprint}:fee-adjustment`,
        `carryover:${sourceTransaction.id}:${target.target.movement.movementFingerprint}:transfer-in`,
        identityConfig,
        {
          provenanceKind: 'internal-transfer-carryover',
          sourceTransactionId: sourceTransaction.id,
          sourceMovementFingerprint: resolvedCarryover.source.movement.movementFingerprint,
          targetMovementFingerprint: target.target.movement.movementFingerprint,
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
