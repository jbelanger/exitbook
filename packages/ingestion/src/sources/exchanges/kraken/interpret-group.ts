import { buildExchangeAssetId, parseDecimal, type Currency, type TransactionNote } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';

import type {
  ConfirmedExchangeTransactionDraft,
  ExchangeCorrelationGroup,
  ExchangeFeeDraft,
  ExchangeGroupInterpretation,
  ExchangeMovementDraft,
  ExchangeProviderEvent,
  ExchangeProcessingDiagnostic,
} from '../shared-v2/index.js';

interface InterpretedKrakenEvent {
  event: ExchangeProviderEvent;
  amount: ReturnType<typeof parseDecimal>;
  feeAmount: ReturnType<typeof parseDecimal>;
}

function diagnostic(
  group: ExchangeCorrelationGroup,
  code: ExchangeProcessingDiagnostic['code'],
  severity: ExchangeProcessingDiagnostic['severity'],
  message: string,
  evidence: Record<string, unknown>
): ExchangeProcessingDiagnostic {
  return {
    code,
    severity,
    providerName: group.providerName,
    correlationKey: group.correlationKey,
    providerEventIds: group.events.map((event) => event.providerEventId),
    message,
    evidence,
  };
}

function buildMovementDraft(assetSymbol: Currency, amount: string): Result<ExchangeMovementDraft, Error> {
  const assetIdResult = buildExchangeAssetId('kraken', assetSymbol);
  if (assetIdResult.isErr()) {
    return err(assetIdResult.error);
  }

  return ok({
    assetId: assetIdResult.value,
    assetSymbol,
    grossAmount: amount,
    netAmount: amount,
  });
}

function buildFeeDraft(assetSymbol: Currency, amount: string): Result<ExchangeFeeDraft, Error> {
  const assetIdResult = buildExchangeAssetId('kraken', assetSymbol);
  if (assetIdResult.isErr()) {
    return err(assetIdResult.error);
  }

  return ok({
    assetId: assetIdResult.value,
    assetSymbol,
    amount,
    scope: 'platform',
    settlement: 'balance',
  });
}

function consolidateMovements(movements: ExchangeMovementDraft[]): ExchangeMovementDraft[] {
  const byAsset = new Map<string, ExchangeMovementDraft>();

  for (const movement of movements) {
    const existing = byAsset.get(movement.assetId);
    if (!existing) {
      byAsset.set(movement.assetId, { ...movement });
      continue;
    }

    const grossAmount = parseDecimal(existing.grossAmount).plus(parseDecimal(movement.grossAmount)).toFixed();
    const existingNet = existing.netAmount ?? existing.grossAmount;
    const movementNet = movement.netAmount ?? movement.grossAmount;
    const netAmount = parseDecimal(existingNet).plus(parseDecimal(movementNet)).toFixed();

    byAsset.set(movement.assetId, {
      ...existing,
      grossAmount,
      netAmount,
    });
  }

  return Array.from(byAsset.values());
}

function consolidateFees(fees: ExchangeFeeDraft[]): ExchangeFeeDraft[] {
  const byFee = new Map<string, ExchangeFeeDraft>();

  for (const fee of fees) {
    const key = `${fee.assetId}:${fee.scope}:${fee.settlement}`;
    const existing = byFee.get(key);
    if (!existing) {
      byFee.set(key, { ...fee });
      continue;
    }

    byFee.set(key, {
      ...existing,
      amount: parseDecimal(existing.amount).plus(parseDecimal(fee.amount)).toFixed(),
    });
  }

  return Array.from(byFee.values()).filter((fee) => !parseDecimal(fee.amount).isZero());
}

function hasBalancedSameAssetOpposingPair(
  interpretedEvents: InterpretedKrakenEvent[],
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[]
): boolean {
  if (inflows.length === 0 || outflows.length === 0) {
    return false;
  }

  const signedAmountByAsset = new Map<string, ReturnType<typeof parseDecimal>>();
  let signedFeeTotal = parseDecimal('0');

  for (const event of interpretedEvents) {
    const assetIdResult = buildExchangeAssetId('kraken', event.event.assetSymbol);
    if (assetIdResult.isErr()) {
      return false;
    }

    const existing = signedAmountByAsset.get(assetIdResult.value) ?? parseDecimal('0');
    signedAmountByAsset.set(assetIdResult.value, existing.plus(event.amount));
    signedFeeTotal = signedFeeTotal.plus(event.feeAmount);
  }

  return Array.from(signedAmountByAsset.values()).every((amount) => amount.isZero()) && signedFeeTotal.isZero();
}

function interpretKrakenEvent(event: ExchangeProviderEvent): Result<InterpretedKrakenEvent, Error> {
  const amount = parseDecimal(event.rawAmount);
  const feeAmount = parseDecimal(event.rawFee ?? '0');

  return ok({
    event,
    amount,
    feeAmount,
  });
}

function buildDraft(
  group: ExchangeCorrelationGroup,
  operation: ConfirmedExchangeTransactionDraft['operation'],
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[],
  fees: ExchangeFeeDraft[],
  notes?: TransactionNote[]
): ConfirmedExchangeTransactionDraft {
  const primaryEvent = group.events[0];
  if (!primaryEvent) {
    throw new Error(`Cannot build Kraken draft for empty group ${group.correlationKey}`);
  }

  return {
    externalId: primaryEvent.providerEventId,
    source: 'kraken',
    timestamp: primaryEvent.occurredAt,
    status: primaryEvent.status,
    operation,
    movements: {
      inflows,
      outflows,
    },
    fees,
    ...(notes && notes.length > 0 ? { notes } : {}),
    evidence: {
      providerEventIds: group.events.map((event) => event.providerEventId),
      interpretationRule: `kraken:${operation.type}`,
    },
  };
}

export function interpretKrakenGroup(group: ExchangeCorrelationGroup): ExchangeGroupInterpretation {
  const interpretedEvents: InterpretedKrakenEvent[] = [];

  for (const event of group.events) {
    const interpretedResult = interpretKrakenEvent(event);
    if (interpretedResult.isErr()) {
      return {
        kind: 'unsupported',
        diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', interpretedResult.error.message, {
          providerEventId: event.providerEventId,
        }),
      };
    }
    interpretedEvents.push(interpretedResult.value);
  }

  const inflows: ExchangeMovementDraft[] = [];
  const outflows: ExchangeMovementDraft[] = [];
  const fees: ExchangeFeeDraft[] = [];

  for (const event of interpretedEvents) {
    if (event.amount.isPositive()) {
      const inflowResult = buildMovementDraft(event.event.assetSymbol, event.amount.abs().toFixed());
      if (inflowResult.isErr()) {
        return {
          kind: 'unsupported',
          diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', inflowResult.error.message, {
            providerEventId: event.event.providerEventId,
          }),
        };
      }
      inflows.push(inflowResult.value);
    }

    if (event.amount.isNegative()) {
      const outflowResult = buildMovementDraft(event.event.assetSymbol, event.amount.abs().toFixed());
      if (outflowResult.isErr()) {
        return {
          kind: 'unsupported',
          diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', outflowResult.error.message, {
            providerEventId: event.event.providerEventId,
          }),
        };
      }
      outflows.push(outflowResult.value);
    }

    if (event.feeAmount.isPositive()) {
      const feeResult = buildFeeDraft(event.event.rawFeeCurrency ?? event.event.assetSymbol, event.feeAmount.toFixed());
      if (feeResult.isErr()) {
        return {
          kind: 'unsupported',
          diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', feeResult.error.message, {
            providerEventId: event.event.providerEventId,
          }),
        };
      }
      fees.push(feeResult.value);
    }
  }

  const consolidatedInflows = consolidateMovements(inflows);
  const consolidatedOutflows = consolidateMovements(outflows);
  const consolidatedFees = consolidateFees(fees);

  const overlappingAssetIds = consolidatedInflows
    .map((movement) => movement.assetId)
    .filter((assetId) => consolidatedOutflows.some((movement) => movement.assetId === assetId));

  if (
    overlappingAssetIds.length > 0 &&
    hasBalancedSameAssetOpposingPair(interpretedEvents, consolidatedInflows, consolidatedOutflows)
  ) {
    return {
      kind: 'ambiguous',
      diagnostic: diagnostic(
        group,
        'ambiguous_same_asset_opposing_pair',
        'error',
        'Kraken group netted to zero across the same asset, but the opposing rows are still ambiguous without decisive transfer evidence.',
        {
          inflows: consolidatedInflows.map((movement) => ({
            assetId: movement.assetId,
            amount: movement.grossAmount,
          })),
          nettedToZero: true,
          outflows: consolidatedOutflows.map((movement) => ({
            assetId: movement.assetId,
            amount: movement.grossAmount,
          })),
          rawFees: interpretedEvents.map((event) => ({
            eventId: event.event.providerEventId,
            fee: event.event.rawFee ?? '0',
          })),
        }
      ),
    };
  }

  if (overlappingAssetIds.length > 0) {
    return {
      kind: 'ambiguous',
      diagnostic: diagnostic(
        group,
        'ambiguous_same_asset_opposing_pair',
        'error',
        'Kraken group contains the same asset on both inflow and outflow sides without decisive transfer evidence.',
        {
          inflows: consolidatedInflows.map((movement) => ({
            assetId: movement.assetId,
            amount: movement.grossAmount,
          })),
          outflows: consolidatedOutflows.map((movement) => ({
            assetId: movement.assetId,
            amount: movement.grossAmount,
          })),
          nettedToZero: false,
          overlappingAssetIds,
        }
      ),
    };
  }

  if (interpretedEvents.some((event) => event.feeAmount.isNegative())) {
    return {
      kind: 'ambiguous',
      diagnostic: diagnostic(
        group,
        'contradictory_provider_rows',
        'error',
        'Kraken group contains a negative fee amount, which indicates contradictory provider rows.',
        {
          rawFees: interpretedEvents.map((event) => ({
            eventId: event.event.providerEventId,
            fee: event.event.rawFee ?? '0',
          })),
        }
      ),
    };
  }

  if (consolidatedInflows.length === 0 && consolidatedOutflows.length === 0 && consolidatedFees.length > 0) {
    return {
      kind: 'confirmed',
      draft: buildDraft(group, { category: 'fee', type: 'fee' }, [], [], consolidatedFees),
    };
  }

  if (consolidatedInflows.length > 0 && consolidatedOutflows.length === 0) {
    return {
      kind: 'confirmed',
      draft: buildDraft(group, { category: 'transfer', type: 'deposit' }, consolidatedInflows, [], consolidatedFees),
    };
  }

  if (consolidatedInflows.length === 0 && consolidatedOutflows.length > 0) {
    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        { category: 'transfer', type: 'withdrawal' },
        [],
        consolidatedOutflows,
        consolidatedFees
      ),
    };
  }

  if (consolidatedInflows.length === 1 && consolidatedOutflows.length === 1) {
    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        { category: 'trade', type: 'swap' },
        consolidatedInflows,
        consolidatedOutflows,
        consolidatedFees
      ),
    };
  }

  const uncertaintyNote: TransactionNote = {
    type: 'classification_uncertain',
    severity: 'info',
    message: `Kraken group ${group.correlationKey} has complex multi-leg fund flow and was materialized conservatively as a transfer.`,
    metadata: {
      inflows: consolidatedInflows.map((movement) => ({
        assetId: movement.assetId,
        amount: movement.grossAmount,
      })),
      outflows: consolidatedOutflows.map((movement) => ({
        assetId: movement.assetId,
        amount: movement.grossAmount,
      })),
      providerEventIds: group.events.map((event) => event.providerEventId),
    },
  };

  return {
    kind: 'confirmed',
    draft: buildDraft(
      group,
      { category: 'transfer', type: 'transfer' },
      consolidatedInflows,
      consolidatedOutflows,
      consolidatedFees,
      [uncertaintyNote]
    ),
  };
}
