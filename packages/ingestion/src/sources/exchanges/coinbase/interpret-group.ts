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

interface CoinbaseProviderMetadata extends Record<string, unknown> {
  correlationKey: string;
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
    throw new Error(`Cannot build Coinbase draft for empty group ${group.correlationKey}`);
  }

  const blockchainEvent = group.events.find((event) => event.providerHints.hashHint?.trim());
  const networkName = blockchainEvent?.providerHints.networkHint?.trim();

  return {
    externalId: primaryEvent.providerEventId,
    source: 'coinbase',
    timestamp: primaryEvent.occurredAt,
    status: resolveGroupStatus(group.events),
    operation,
    movements: {
      inflows,
      outflows,
    },
    fees,
    ...(notes && notes.length > 0 ? { notes } : {}),
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
    return {
      kind: 'confirmed',
      draft: buildDraft(
        group,
        sameAsset ? { category: 'transfer', type: 'transfer' } : { category: 'trade', type: 'swap' },
        consolidatedInflows,
        consolidatedOutflows,
        consolidatedFees
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

  const note: TransactionNote = {
    type: 'classification_uncertain',
    severity: 'info',
    message: `Coinbase group ${group.correlationKey} has complex multi-leg fund flow and was materialized conservatively as a transfer.`,
    metadata: {
      inflows: consolidatedInflows.map((movement) => ({ assetId: movement.assetId, amount: movement.grossAmount })),
      outflows: consolidatedOutflows.map((movement) => ({ assetId: movement.assetId, amount: movement.grossAmount })),
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
      [note]
    ),
  };
}
