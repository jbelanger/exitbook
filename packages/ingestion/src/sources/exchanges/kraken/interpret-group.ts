import { POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE, type TransactionDiagnostic } from '@exitbook/core';
import { buildExchangeAssetId, parseDecimal, type Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';

import type {
  ConfirmedExchangeTransactionDraft,
  ExchangeCorrelationGroup,
  ExchangeFeeDraft,
  ExchangeGroupInterpretation,
  ExchangeMovementDraft,
} from '../shared/index.js';
import { consolidateFees, consolidateMovements, diagnostic } from '../shared/interpret-group-utils.js';

import type { KrakenProviderEvent, KrakenProviderMetadata } from './normalize-provider-event.js';

interface InterpretedKrakenEvent {
  event: KrakenProviderEvent;
  amount: ReturnType<typeof parseDecimal>;
  feeAmount: ReturnType<typeof parseDecimal>;
}

function getKrakenSubtype(event: KrakenProviderEvent): string | undefined {
  const normalized = event.providerMetadata.subtype?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function getSharedKrakenSubtype(interpretedEvents: readonly InterpretedKrakenEvent[]): string | undefined {
  const subtypes = new Set(
    interpretedEvents.map((event) => getKrakenSubtype(event.event)).filter((value) => value !== undefined)
  );
  if (subtypes.size !== 1) {
    return undefined;
  }

  return [...subtypes][0];
}

function getSharedProviderType(interpretedEvents: readonly InterpretedKrakenEvent[]): string | undefined {
  const providerTypes = new Set(interpretedEvents.map((event) => event.event.providerType.trim().toLowerCase()));
  if (providerTypes.size !== 1) {
    return undefined;
  }

  return [...providerTypes][0];
}

function buildMovementDraft(
  assetSymbol: Currency,
  amount: string,
  movementRole?: ExchangeMovementDraft['movementRole']
): Result<ExchangeMovementDraft, Error> {
  const assetIdResult = buildExchangeAssetId('kraken', assetSymbol);
  if (assetIdResult.isErr()) {
    return err(assetIdResult.error);
  }

  return ok({
    assetId: assetIdResult.value,
    assetSymbol,
    grossAmount: amount,
    netAmount: amount,
    ...(movementRole ? { movementRole } : {}),
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

function isNetZeroTransferReversalPair(
  interpretedEvents: InterpretedKrakenEvent[],
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[]
): boolean {
  if (interpretedEvents.length !== 2) {
    return false;
  }

  if (!hasBalancedSameAssetOpposingPair(interpretedEvents, inflows, outflows)) {
    return false;
  }

  const providerTypes = new Set(interpretedEvents.map((event) => event.event.providerType));
  if (providerTypes.size !== 1) {
    return false;
  }

  const [providerType] = providerTypes;
  if (providerType !== 'deposit' && providerType !== 'withdrawal') {
    return false;
  }

  const assetSymbols = new Set(interpretedEvents.map((event) => event.event.assetSymbol));
  if (assetSymbols.size !== 1) {
    return false;
  }

  return interpretedEvents.some((event) => event.feeAmount.isNegative());
}

function interpretKrakenEvent(event: KrakenProviderEvent): Result<InterpretedKrakenEvent, Error> {
  const amount = parseDecimal(event.rawAmount);
  const feeAmount = parseDecimal(event.rawFee ?? '0');

  return ok({
    event,
    amount,
    feeAmount,
  });
}

function buildDraft(
  group: ExchangeCorrelationGroup<KrakenProviderMetadata>,
  operation: ConfirmedExchangeTransactionDraft['operation'],
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[],
  fees: ExchangeFeeDraft[],
  diagnostics?: TransactionDiagnostic[]
): ConfirmedExchangeTransactionDraft {
  const primaryEvent = group.events[0];
  if (!primaryEvent) {
    throw new Error(`Cannot build Kraken draft for empty group ${group.correlationKey}`);
  }

  return {
    source: 'kraken',
    timestamp: primaryEvent.occurredAt,
    status: primaryEvent.status,
    operation,
    movements: {
      inflows,
      outflows,
    },
    fees,
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
    evidence: {
      providerEventIds: group.events.map((event) => event.providerEventId),
      interpretationRule: `kraken:${operation.type}`,
    },
  };
}

function buildDustSweepingDiagnostics(
  group: ExchangeCorrelationGroup<KrakenProviderMetadata>,
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[]
): TransactionDiagnostic[] | undefined {
  if (inflows.length <= 1 && outflows.length <= 1) {
    return undefined;
  }

  return [
    {
      code: 'allocation_uncertain',
      severity: 'warning',
      message: `Kraken dustsweeping group ${group.correlationKey} was classified as a dust conversion, but Kraken does not provide an exact per-asset proceeds allocation across every disposed asset in the group.`,
      metadata: {
        inflows: inflows.map((movement) => ({
          assetId: movement.assetId,
          amount: movement.grossAmount,
        })),
        outflows: outflows.map((movement) => ({
          assetId: movement.assetId,
          amount: movement.grossAmount,
        })),
        providerEventIds: group.events.map((event) => event.providerEventId),
        providerSubtype: 'dustsweeping',
      },
    },
  ];
}

function buildPossibleAssetMigrationDiagnostics(
  group: ExchangeCorrelationGroup<KrakenProviderMetadata>,
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[]
): TransactionDiagnostic[] {
  const migrationGroupKey = group.events
    .map((event) => event.providerMetadata['refid'])
    .find((refid): refid is string => typeof refid === 'string' && refid.trim().length > 0);

  return [
    {
      code: POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE,
      severity: 'info',
      message:
        'Kraken spotfromfutures rows may reflect an internal asset migration. Inspect the paired ledger rows before creating a manual link.',
      metadata: {
        inflows: inflows.map((movement) => ({
          assetId: movement.assetId,
          amount: movement.grossAmount,
        })),
        outflows: outflows.map((movement) => ({
          assetId: movement.assetId,
          amount: movement.grossAmount,
        })),
        migrationGroupKey: migrationGroupKey ?? group.correlationKey,
        providerEventIds: group.events.map((event) => event.providerEventId),
        providerSubtype: 'spotfromfutures',
      },
    },
  ];
}

function combineDiagnostics(
  ...diagnosticGroups: (TransactionDiagnostic[] | undefined)[]
): TransactionDiagnostic[] | undefined {
  const diagnostics = diagnosticGroups.flatMap((group) => group ?? []);
  return diagnostics.length > 0 ? diagnostics : undefined;
}

function buildOneSidedTradeResidualDiagnostic(params: {
  group: ExchangeCorrelationGroup<KrakenProviderMetadata>;
  inferredTradeType: 'buy' | 'sell';
  providerSubtype?: string | undefined;
}): TransactionDiagnostic {
  const subtypeLabel = params.providerSubtype ? `/${params.providerSubtype}` : '';
  const residualDirection = params.inferredTradeType === 'buy' ? 'credit' : 'debit';

  return {
    code: 'classification_uncertain',
    severity: 'info',
    message:
      `Kraken group ${params.group.correlationKey} contains only a ${residualDirection} leg from a ` +
      `one-sided ${`trade${subtypeLabel}`} provider row, so it was materialized as a non-transfer trade residual.`,
    metadata: {
      inferredTradeType: params.inferredTradeType,
      providerEventIds: params.group.events.map((event) => event.providerEventId),
      providerSubtype: params.providerSubtype,
      providerType: 'trade',
      residualRole: 'refund_rebate',
    },
  };
}

export function interpretKrakenGroup(
  group: ExchangeCorrelationGroup<KrakenProviderMetadata>
): ExchangeGroupInterpretation {
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
  const sharedSubtype = getSharedKrakenSubtype(interpretedEvents);
  const sharedProviderType = getSharedProviderType(interpretedEvents);
  const migrationDiagnostics =
    sharedSubtype === 'spotfromfutures'
      ? buildPossibleAssetMigrationDiagnostics(group, consolidatedInflows, consolidatedOutflows)
      : undefined;

  const overlappingAssetIds = consolidatedInflows
    .map((movement) => movement.assetId)
    .filter((assetId) => consolidatedOutflows.some((movement) => movement.assetId === assetId));

  if (
    overlappingAssetIds.length > 0 &&
    isNetZeroTransferReversalPair(interpretedEvents, consolidatedInflows, consolidatedOutflows)
  ) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(
        group,
        'provider_reversal_pair',
        'warning',
        'Kraken group is a net-zero transfer reversal pair, so it was skipped instead of materialized.',
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
          providerTypes: interpretedEvents.map((event) => event.event.providerType),
          rawFees: interpretedEvents.map((event) => ({
            eventId: event.event.providerEventId,
            fee: event.event.rawFee ?? '0',
          })),
        }
      ),
    };
  }

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

  if (sharedSubtype === 'dustsweeping' && consolidatedInflows.length > 0 && consolidatedOutflows.length > 0) {
    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        { category: 'trade', type: 'swap' },
        consolidatedInflows,
        consolidatedOutflows,
        consolidatedFees,
        buildDustSweepingDiagnostics(group, consolidatedInflows, consolidatedOutflows)
      ),
    };
  }

  if (sharedProviderType === 'trade' && consolidatedInflows.length > 0 && consolidatedOutflows.length === 0) {
    const residualInflows = consolidatedInflows.map((movement) => ({
      ...movement,
      movementRole: 'refund_rebate' as const,
    }));

    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        { category: 'trade', type: 'buy' },
        residualInflows,
        [],
        consolidatedFees,
        combineDiagnostics(
          [
            buildOneSidedTradeResidualDiagnostic({
              group,
              inferredTradeType: 'buy',
              providerSubtype: sharedSubtype,
            }),
          ],
          migrationDiagnostics
        )
      ),
    };
  }

  if (sharedProviderType === 'trade' && consolidatedInflows.length === 0 && consolidatedOutflows.length > 0) {
    const residualOutflows = consolidatedOutflows.map((movement) => ({
      ...movement,
      movementRole: 'refund_rebate' as const,
    }));

    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        { category: 'trade', type: 'sell' },
        [],
        residualOutflows,
        consolidatedFees,
        combineDiagnostics(
          [
            buildOneSidedTradeResidualDiagnostic({
              group,
              inferredTradeType: 'sell',
              providerSubtype: sharedSubtype,
            }),
          ],
          migrationDiagnostics
        )
      ),
    };
  }

  if (consolidatedInflows.length > 0 && consolidatedOutflows.length === 0) {
    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        { category: 'transfer', type: 'deposit' },
        consolidatedInflows,
        [],
        consolidatedFees,
        migrationDiagnostics
      ),
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
        consolidatedFees,
        migrationDiagnostics
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
        consolidatedFees,
        migrationDiagnostics
      ),
    };
  }

  const uncertaintyNote: TransactionDiagnostic = {
    code: 'classification_uncertain',
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
      combineDiagnostics([uncertaintyNote], migrationDiagnostics)
    ),
  };
}
