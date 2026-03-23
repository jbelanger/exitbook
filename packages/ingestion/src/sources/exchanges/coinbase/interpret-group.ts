import { buildExchangeAssetId, parseDecimal, type Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';

import type {
  ConfirmedExchangeTransactionDraft,
  ExchangeCorrelationGroup,
  ExchangeFeeDraft,
  ExchangeGroupInterpretation,
  ExchangeMovementDraft,
  ExchangeProviderEvent,
} from '../shared/index.js';
import { consolidateFees, consolidateMovements, diagnostic } from '../shared/interpret-group-utils.js';

interface CoinbaseProviderMetadata extends Record<string, unknown> {
  correlationKey: string;
  correlationSource: 'event_id' | 'id' | 'order_id' | 'trade_id' | 'transfer_id';
  entryType: string;
  feeEmbeddedInAmount: boolean;
  feeSettlementHint: 'balance' | 'on-chain' | 'none';
  networkName?: string | undefined;
}

interface InterpretedCoinbaseEvent {
  event: ExchangeProviderEvent;
  metadata: CoinbaseProviderMetadata;
  amount: ReturnType<typeof parseDecimal>;
  feeAmount: ReturnType<typeof parseDecimal>;
  feeCurrency: Currency;
}

function getMetadata(event: ExchangeProviderEvent): CoinbaseProviderMetadata {
  return event.providerMetadata as unknown as CoinbaseProviderMetadata;
}

function buildMovementDraft(
  exchangeName: string,
  assetSymbol: Currency,
  amount: string
): Result<ExchangeMovementDraft, Error> {
  const assetIdResult = buildExchangeAssetId(exchangeName, assetSymbol);
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

function buildFeeDraft(
  exchangeName: string,
  assetSymbol: Currency,
  amount: string,
  settlement: ExchangeFeeDraft['settlement']
): Result<ExchangeFeeDraft, Error> {
  const assetIdResult = buildExchangeAssetId(exchangeName, assetSymbol);
  if (assetIdResult.isErr()) {
    return err(assetIdResult.error);
  }

  return ok({
    assetId: assetIdResult.value,
    assetSymbol,
    amount,
    scope: 'platform',
    settlement,
  });
}

function interpretEvent(event: ExchangeProviderEvent): Result<InterpretedCoinbaseEvent, Error> {
  const metadata = getMetadata(event);
  const feeCurrency = event.rawFeeCurrency ?? event.assetSymbol;

  return ok({
    event,
    metadata,
    amount: parseDecimal(event.rawAmount),
    feeAmount: parseDecimal(event.rawFee ?? '0'),
    feeCurrency,
  });
}

function shouldEmitFee(event: InterpretedCoinbaseEvent, group: InterpretedCoinbaseEvent[]): boolean {
  if (event.feeAmount.isZero()) {
    return false;
  }

  if (event.metadata.entryType === 'advanced_trade_fill') {
    return event.event.assetSymbol === event.feeCurrency;
  }

  if (event.metadata.entryType === 'buy' || event.metadata.entryType === 'sell') {
    const firstMatchingEvent = group.find(
      (candidate) =>
        candidate.event.rawFee === event.event.rawFee && candidate.event.rawFeeCurrency === event.event.rawFeeCurrency
    );
    return firstMatchingEvent?.event.providerEventId === event.event.providerEventId;
  }

  return true;
}

function resolveGroupStatus(events: ExchangeProviderEvent[]) {
  if (events.some((event) => event.status === 'failed')) {
    return 'failed' as const;
  }

  if (events.some((event) => event.status === 'canceled')) {
    return 'canceled' as const;
  }

  if (events.some((event) => event.status === 'pending' || event.status === 'open')) {
    return 'pending' as const;
  }

  return 'success' as const;
}

function isTransferLikeEntryType(entryType: string): boolean {
  return (
    entryType === 'fiat_deposit' ||
    entryType === 'fiat_withdrawal' ||
    entryType === 'send' ||
    entryType === 'transaction'
  );
}

function hasExplicitTransferEvidence(group: ExchangeCorrelationGroup, events: InterpretedCoinbaseEvent[]): boolean {
  if (events.length === 0 || events.some((event) => !isTransferLikeEntryType(event.metadata.entryType))) {
    return false;
  }

  if (events.some((event) => event.metadata.correlationSource === 'transfer_id')) {
    return true;
  }

  if (
    group.events.some(
      (event) => Boolean(event.providerHints.addressHint?.trim()) || Boolean(event.providerHints.hashHint?.trim())
    )
  ) {
    return true;
  }

  return events.some((event) => event.metadata.correlationKey !== event.event.providerEventId);
}

function buildDraft(
  group: ExchangeCorrelationGroup,
  operation: ConfirmedExchangeTransactionDraft['operation'],
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[],
  fees: ExchangeFeeDraft[]
): ConfirmedExchangeTransactionDraft {
  const primaryEvent = group.events[0];
  if (!primaryEvent) {
    throw new Error(`Cannot build Coinbase draft for empty group ${group.correlationKey}`);
  }

  const blockchainEvent = group.events.find((event) => event.providerHints.hashHint?.trim());
  const networkName = blockchainEvent?.providerHints.networkHint?.trim();

  return {
    source: 'coinbase',
    timestamp: primaryEvent.occurredAt,
    status: resolveGroupStatus(group.events),
    operation,
    movements: {
      inflows,
      outflows,
    },
    fees,
    ...(blockchainEvent?.providerHints.addressHint?.trim()
      ? { to: blockchainEvent.providerHints.addressHint.trim() }
      : {}),
    ...(blockchainEvent?.providerHints.hashHint?.trim()
      ? {
          blockchain: {
            name: networkName && networkName.length > 0 ? networkName : 'unknown',
            transactionHash: blockchainEvent.providerHints.hashHint.trim(),
            isConfirmed: blockchainEvent.status === 'success',
          },
        }
      : {}),
    evidence: {
      providerEventIds: group.events.map((event) => event.providerEventId),
      interpretationRule: `coinbase:${operation.type}`,
    },
  };
}

export function interpretCoinbaseGroup(group: ExchangeCorrelationGroup): ExchangeGroupInterpretation {
  const interpretedEvents: InterpretedCoinbaseEvent[] = [];

  for (const event of group.events) {
    const result = interpretEvent(event);
    if (result.isErr()) {
      return {
        kind: 'unsupported',
        diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', result.error.message, {
          providerEventId: event.providerEventId,
        }),
      };
    }
    interpretedEvents.push(result.value);
  }

  const inflows: ExchangeMovementDraft[] = [];
  const outflows: ExchangeMovementDraft[] = [];
  const fees: ExchangeFeeDraft[] = [];

  for (const interpretedEvent of interpretedEvents) {
    const absAmount = interpretedEvent.amount.abs().toFixed();
    const movementResult = buildMovementDraft('coinbase', interpretedEvent.event.assetSymbol, absAmount);
    if (movementResult.isErr()) {
      return {
        kind: 'unsupported',
        diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', movementResult.error.message, {
          providerEventId: interpretedEvent.event.providerEventId,
        }),
      };
    }

    const movement = movementResult.value;
    if (
      interpretedEvent.metadata.feeSettlementHint === 'on-chain' &&
      !interpretedEvent.metadata.feeEmbeddedInAmount &&
      interpretedEvent.amount.isNegative()
    ) {
      movement.netAmount = parseDecimal(movement.grossAmount).minus(interpretedEvent.feeAmount).toFixed();
    }

    if (interpretedEvent.amount.isPositive()) {
      inflows.push(movement);
    } else if (interpretedEvent.amount.isNegative()) {
      outflows.push(movement);
    }

    if (shouldEmitFee(interpretedEvent, interpretedEvents)) {
      const feeResult = buildFeeDraft(
        'coinbase',
        interpretedEvent.feeCurrency,
        interpretedEvent.feeAmount.toFixed(),
        interpretedEvent.metadata.feeSettlementHint === 'balance' ? 'balance' : 'on-chain'
      );
      if (feeResult.isErr()) {
        return {
          kind: 'unsupported',
          diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', feeResult.error.message, {
            providerEventId: interpretedEvent.event.providerEventId,
          }),
        };
      }

      if (!parseDecimal(feeResult.value.amount).isZero()) {
        fees.push(feeResult.value);
      }
    }
  }

  const consolidatedInflows = consolidateMovements(inflows);
  const consolidatedOutflows = consolidateMovements(outflows);
  const consolidatedFees = consolidateFees(fees);
  const entryTypes = new Set(interpretedEvents.map((event) => event.metadata.entryType));

  if (entryTypes.size === 1 && entryTypes.has('interest')) {
    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        { category: 'staking', type: 'reward' },
        consolidatedInflows,
        consolidatedOutflows,
        consolidatedFees
      ),
    };
  }

  if (consolidatedOutflows.length === 1 && consolidatedInflows.length === 1) {
    const sameAsset = consolidatedOutflows[0]?.assetId === consolidatedInflows[0]?.assetId;
    if (!sameAsset) {
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

    if (hasExplicitTransferEvidence(group, interpretedEvents)) {
      return {
        kind: 'confirmed',
        draft: buildDraft(
          group,
          { category: 'transfer', type: 'transfer' },
          consolidatedInflows,
          consolidatedOutflows,
          consolidatedFees
        ),
      };
    }

    return {
      kind: 'ambiguous',
      diagnostic: diagnostic(
        group,
        'ambiguous_same_asset_opposing_pair',
        'error',
        'Coinbase group contains same-asset inflow and outflow rows without decisive transfer evidence.',
        {
          correlationSource: interpretedEvents.map((event) => event.metadata.correlationSource),
          entryTypes: interpretedEvents.map((event) => event.metadata.entryType),
          inflows: consolidatedInflows.map((movement) => ({ assetId: movement.assetId, amount: movement.grossAmount })),
          outflows: consolidatedOutflows.map((movement) => ({
            assetId: movement.assetId,
            amount: movement.grossAmount,
          })),
          providerEventIds: group.events.map((event) => event.providerEventId),
        }
      ),
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

  if (consolidatedInflows.length === 0 && consolidatedOutflows.length === 0 && consolidatedFees.length > 0) {
    return {
      kind: 'confirmed',
      draft: buildDraft(group, { category: 'fee', type: 'fee' }, [], [], consolidatedFees),
    };
  }

  return {
    kind: 'unsupported',
    diagnostic: diagnostic(
      group,
      'unsupported_multi_leg_pattern',
      'error',
      'Coinbase group has a complex multi-leg fund flow that is not yet supported by the provider-owned interpreter.',
      {
        entryTypes: interpretedEvents.map((event) => event.metadata.entryType),
        inflows: consolidatedInflows.map((movement) => ({ assetId: movement.assetId, amount: movement.grossAmount })),
        outflows: consolidatedOutflows.map((movement) => ({ assetId: movement.assetId, amount: movement.grossAmount })),
        providerEventIds: group.events.map((event) => event.providerEventId),
      }
    ),
  };
}
