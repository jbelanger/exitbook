import { buildExchangeAssetId, parseDecimal, type Currency, type TransactionStatus } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';

import type {
  ConfirmedExchangeTransactionDraft,
  ExchangeCorrelationGroup,
  ExchangeFeeDraft,
  ExchangeGroupInterpretation,
  ExchangeMovementDraft,
  ExchangeProviderEvent,
} from '../shared/index.js';
import { consolidateFees, consolidateMovements, diagnostic } from '../shared/interpret-group-utils.js';

import type {
  KucoinAccountHistoryProviderMetadata,
  KucoinProviderMetadata,
  KucoinTradeProviderMetadata,
  KucoinTransferProviderMetadata,
} from './normalize-provider-event.js';

function getMetadata(event: ExchangeProviderEvent): KucoinProviderMetadata {
  return event.providerMetadata as KucoinProviderMetadata;
}

function buildMovementDraft(assetSymbol: Currency, amount: string): Result<ExchangeMovementDraft, Error> {
  const assetIdResult = buildExchangeAssetId('kucoin', assetSymbol);
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
  const assetIdResult = buildExchangeAssetId('kucoin', assetSymbol);
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

function buildDraft(
  group: ExchangeCorrelationGroup,
  operation: ConfirmedExchangeTransactionDraft['operation'],
  inflows: ExchangeMovementDraft[],
  outflows: ExchangeMovementDraft[],
  fees: ExchangeFeeDraft[],
  status: TransactionStatus,
  options?: {
    blockchain?:
      | {
          isConfirmed: boolean;
          name: string;
          transactionHash: string;
        }
      | undefined;
    to?: string | undefined;
  }
): ConfirmedExchangeTransactionDraft {
  const primaryEvent = group.events[0];
  if (!primaryEvent) {
    throw new Error(`Cannot build KuCoin draft for empty group ${group.correlationKey}`);
  }

  return {
    source: 'kucoin',
    timestamp: primaryEvent.occurredAt,
    status,
    operation,
    movements: {
      inflows,
      outflows,
    },
    fees,
    ...(options?.to ? { to: options.to } : {}),
    ...(options?.blockchain ? { blockchain: options.blockchain } : {}),
    evidence: {
      providerEventIds: group.events.map((event) => event.providerEventId),
      interpretationRule: `kucoin:${operation.type}`,
    },
  };
}

function resolveGroupStatus(events: ExchangeProviderEvent[]): TransactionStatus {
  if (events.some((event) => event.status === 'failed')) {
    return 'failed';
  }

  if (events.some((event) => event.status === 'canceled')) {
    return 'canceled';
  }

  if (events.some((event) => event.status === 'pending' || event.status === 'open')) {
    return 'pending';
  }

  if (events.some((event) => event.status === 'closed')) {
    return 'closed';
  }

  return events[0]?.status ?? 'success';
}

function interpretTradeGroup(
  group: ExchangeCorrelationGroup,
  tradeEvents: { event: ExchangeProviderEvent; metadata: KucoinTradeProviderMetadata }[]
): ExchangeGroupInterpretation {
  const firstTrade = tradeEvents[0];
  if (!firstTrade) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', 'Empty KuCoin trade group', {}),
    };
  }

  const inconsistentTradeEvent = tradeEvents.find(
    ({ metadata }) =>
      metadata.side !== firstTrade.metadata.side ||
      metadata.baseCurrency !== firstTrade.metadata.baseCurrency ||
      metadata.quoteCurrency !== firstTrade.metadata.quoteCurrency
  );

  if (inconsistentTradeEvent) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(
        group,
        'unsupported_multi_leg_pattern',
        'error',
        'KuCoin trade group contains inconsistent sides or asset pairs and cannot be materialized safely.',
        {
          providerEventIds: tradeEvents.map(({ event }) => event.providerEventId),
          sides: tradeEvents.map(({ metadata }) => metadata.side),
          assetPairs: tradeEvents.map(({ metadata }) => `${metadata.baseCurrency}-${metadata.quoteCurrency}`),
        }
      ),
    };
  }

  const inflows: ExchangeMovementDraft[] = [];
  const outflows: ExchangeMovementDraft[] = [];
  const fees: ExchangeFeeDraft[] = [];

  for (const { event, metadata } of tradeEvents) {
    const baseAmount = parseDecimal(metadata.filledAmount).abs().toFixed();
    const quoteAmount = parseDecimal(metadata.filledVolume).abs().toFixed();
    const outflowResult = buildMovementDraft(
      metadata.side === 'buy' ? metadata.quoteCurrency : metadata.baseCurrency,
      metadata.side === 'buy' ? quoteAmount : baseAmount
    );
    if (outflowResult.isErr()) {
      return {
        kind: 'unsupported',
        diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', outflowResult.error.message, {
          providerEventId: event.providerEventId,
        }),
      };
    }

    const inflowResult = buildMovementDraft(
      metadata.side === 'buy' ? metadata.baseCurrency : metadata.quoteCurrency,
      metadata.side === 'buy' ? baseAmount : quoteAmount
    );
    if (inflowResult.isErr()) {
      return {
        kind: 'unsupported',
        diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', inflowResult.error.message, {
          providerEventId: event.providerEventId,
        }),
      };
    }

    outflows.push(outflowResult.value);
    inflows.push(inflowResult.value);

    const feeAmount = parseDecimal(event.rawFee ?? '0');
    if (feeAmount.isPositive()) {
      const feeCurrency = metadata.feeCurrency ?? event.rawFeeCurrency;
      if (!feeCurrency) {
        return {
          kind: 'unsupported',
          diagnostic: diagnostic(
            group,
            'provider_event_validation_failed',
            'error',
            `KuCoin trade event ${event.providerEventId} had a fee amount with no fee currency.`,
            { providerEventId: event.providerEventId }
          ),
        };
      }

      const feeResult = buildFeeDraft(feeCurrency, feeAmount.toFixed());
      if (feeResult.isErr()) {
        return {
          kind: 'unsupported',
          diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', feeResult.error.message, {
            providerEventId: event.providerEventId,
          }),
        };
      }

      fees.push(feeResult.value);
    }
  }

  return {
    kind: 'confirmed',
    draft: buildDraft(
      group,
      { category: 'trade', type: firstTrade.metadata.side },
      consolidateMovements(inflows),
      consolidateMovements(outflows),
      consolidateFees(fees),
      resolveGroupStatus(group.events)
    ),
  };
}

function interpretTransferGroup(
  group: ExchangeCorrelationGroup,
  transferEvent: { event: ExchangeProviderEvent; metadata: KucoinTransferProviderMetadata }
): ExchangeGroupInterpretation {
  const amount = parseDecimal(transferEvent.event.rawAmount).abs().toFixed();
  const movementResult = buildMovementDraft(transferEvent.event.assetSymbol, amount);
  if (movementResult.isErr()) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', movementResult.error.message, {
        providerEventId: transferEvent.event.providerEventId,
      }),
    };
  }

  const feeAmount = parseDecimal(transferEvent.event.rawFee ?? '0');
  const fees: ExchangeFeeDraft[] = [];
  if (feeAmount.isPositive()) {
    const feeResult = buildFeeDraft(
      transferEvent.event.rawFeeCurrency ?? transferEvent.event.assetSymbol,
      feeAmount.toFixed()
    );
    if (feeResult.isErr()) {
      return {
        kind: 'unsupported',
        diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', feeResult.error.message, {
          providerEventId: transferEvent.event.providerEventId,
        }),
      };
    }

    fees.push(feeResult.value);
  }

  const blockchain =
    transferEvent.metadata.hash && transferEvent.metadata.hash.trim().length > 0
      ? {
          name: transferEvent.metadata.transferNetwork?.trim() || 'unknown',
          transactionHash: transferEvent.metadata.hash.trim(),
          isConfirmed: transferEvent.event.status === 'success',
        }
      : undefined;

  return {
    kind: 'confirmed',
    draft: buildDraft(
      group,
      {
        category: 'transfer',
        type: transferEvent.metadata.rowKind === 'deposit' ? 'deposit' : 'withdrawal',
      },
      transferEvent.metadata.rowKind === 'deposit' ? [movementResult.value] : [],
      transferEvent.metadata.rowKind === 'withdrawal' ? [movementResult.value] : [],
      fees,
      transferEvent.event.status,
      {
        ...(transferEvent.metadata.address ? { to: transferEvent.metadata.address } : {}),
        ...(blockchain ? { blockchain } : {}),
      }
    ),
  };
}

function interpretAccountHistoryGroup(
  group: ExchangeCorrelationGroup,
  historyEvents: { event: ExchangeProviderEvent; metadata: KucoinAccountHistoryProviderMetadata }[]
): ExchangeGroupInterpretation {
  if (historyEvents.some(({ metadata }) => metadata.type !== 'convert market')) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(
        group,
        'unsupported_multi_leg_pattern',
        'warning',
        'KuCoin account history row type is not supported by the v2 exchange processor and was skipped.',
        {
          types: historyEvents.map(({ metadata }) => metadata.type),
          providerEventIds: historyEvents.map(({ event }) => event.providerEventId),
        }
      ),
    };
  }

  if (historyEvents.length !== 2) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(
        group,
        'unsupported_multi_leg_pattern',
        'error',
        'KuCoin convert market group did not contain exactly one debit and one credit row.',
        {
          count: historyEvents.length,
          providerEventIds: historyEvents.map(({ event }) => event.providerEventId),
        }
      ),
    };
  }

  const creditEvent = historyEvents.find(({ metadata }) => metadata.side === 'credit');
  const debitEvent = historyEvents.find(({ metadata }) => metadata.side === 'debit');

  if (!creditEvent || !debitEvent) {
    return {
      kind: 'ambiguous',
      diagnostic: diagnostic(
        group,
        'missing_direction_evidence',
        'error',
        'KuCoin convert market group is missing a credit/debit pairing and cannot be interpreted safely.',
        {
          directions: historyEvents.map(({ metadata }) => metadata.side),
          providerEventIds: historyEvents.map(({ event }) => event.providerEventId),
        }
      ),
    };
  }

  if (creditEvent.event.assetSymbol === debitEvent.event.assetSymbol) {
    return {
      kind: 'ambiguous',
      diagnostic: diagnostic(
        group,
        'contradictory_provider_rows',
        'error',
        'KuCoin convert market group used the same asset for both debit and credit rows.',
        {
          assetSymbol: creditEvent.event.assetSymbol,
          providerEventIds: [debitEvent.event.providerEventId, creditEvent.event.providerEventId],
        }
      ),
    };
  }

  const inflowResult = buildMovementDraft(
    creditEvent.event.assetSymbol,
    parseDecimal(creditEvent.event.rawAmount).abs().toFixed()
  );
  if (inflowResult.isErr()) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', inflowResult.error.message, {
        providerEventId: creditEvent.event.providerEventId,
      }),
    };
  }

  const outflowResult = buildMovementDraft(
    debitEvent.event.assetSymbol,
    parseDecimal(debitEvent.event.rawAmount).abs().toFixed()
  );
  if (outflowResult.isErr()) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', outflowResult.error.message, {
        providerEventId: debitEvent.event.providerEventId,
      }),
    };
  }

  const fees: ExchangeFeeDraft[] = [];
  for (const { event } of historyEvents) {
    const feeAmount = parseDecimal(event.rawFee ?? '0');
    if (!feeAmount.isPositive()) {
      continue;
    }

    const feeResult = buildFeeDraft(event.rawFeeCurrency ?? event.assetSymbol, feeAmount.toFixed());
    if (feeResult.isErr()) {
      return {
        kind: 'unsupported',
        diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', feeResult.error.message, {
          providerEventId: event.providerEventId,
        }),
      };
    }

    fees.push(feeResult.value);
  }

  return {
    kind: 'confirmed',
    draft: buildDraft(
      group,
      { category: 'trade', type: 'swap' },
      [inflowResult.value],
      [outflowResult.value],
      consolidateFees(fees),
      'success'
    ),
  };
}

export function interpretKucoinGroup(group: ExchangeCorrelationGroup): ExchangeGroupInterpretation {
  if (group.events.length === 0) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', 'Empty KuCoin group', {}),
    };
  }

  const metadata = group.events.map((event) => ({ event, metadata: getMetadata(event) }));
  const rowKinds = new Set(metadata.map(({ metadata: providerMetadata }) => providerMetadata.rowKind));

  if (rowKinds.size !== 1) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(
        group,
        'unsupported_multi_leg_pattern',
        'error',
        'KuCoin group mixed incompatible row kinds and cannot be interpreted safely.',
        {
          rowKinds: metadata.map(({ metadata: providerMetadata }) => providerMetadata.rowKind),
          providerEventIds: metadata.map(({ event }) => event.providerEventId),
        }
      ),
    };
  }

  const rowKind = metadata[0]?.metadata.rowKind;
  if (!rowKind) {
    return {
      kind: 'unsupported',
      diagnostic: diagnostic(group, 'provider_event_validation_failed', 'error', 'Missing KuCoin row kind', {}),
    };
  }

  switch (rowKind) {
    case 'spot_order':
    case 'order_splitting':
    case 'trading_bot':
      return interpretTradeGroup(
        group,
        metadata as { event: ExchangeProviderEvent; metadata: KucoinTradeProviderMetadata }[]
      );
    case 'deposit':
    case 'withdrawal': {
      if (metadata.length !== 1) {
        return {
          kind: 'unsupported',
          diagnostic: diagnostic(
            group,
            'unsupported_multi_leg_pattern',
            'error',
            `KuCoin ${rowKind} group unexpectedly contained ${metadata.length} rows.`,
            {
              providerEventIds: metadata.map(({ event }) => event.providerEventId),
            }
          ),
        };
      }

      return interpretTransferGroup(
        group,
        metadata[0] as { event: ExchangeProviderEvent; metadata: KucoinTransferProviderMetadata }
      );
    }
    case 'account_history':
      return interpretAccountHistoryGroup(
        group,
        metadata as { event: ExchangeProviderEvent; metadata: KucoinAccountHistoryProviderMetadata }[]
      );
  }
}
