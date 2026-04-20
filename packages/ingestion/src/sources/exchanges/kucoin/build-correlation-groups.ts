import { parseDecimal } from '@exitbook/foundation';

import type { ExchangeCorrelationGroup, ExchangeProviderEvent } from '../shared/index.js';

import type { KuCoinProviderMetadata } from './normalize-provider-event.js';

const ACCOUNT_HISTORY_TRANSFER_PAIRING_WINDOW_MS = 5_000;

function getMetadata(event: ExchangeProviderEvent): KuCoinProviderMetadata {
  return event.providerMetadata as KuCoinProviderMetadata;
}

function getEvidenceAssetSymbols(event: ExchangeProviderEvent): string[] {
  const metadata = getMetadata(event);

  if (
    metadata.rowKind === 'spot_order' ||
    metadata.rowKind === 'order_splitting' ||
    metadata.rowKind === 'trading_bot'
  ) {
    const tradeMetadata = metadata;
    return [tradeMetadata.baseCurrency, tradeMetadata.quoteCurrency];
  }

  return [event.assetSymbol];
}

function createCorrelationGroup(
  correlationKey: string,
  groupEvents: readonly ExchangeProviderEvent[]
): ExchangeCorrelationGroup {
  const sortedEvents = [...groupEvents].sort((left, right) => left.occurredAt - right.occurredAt);
  const timestamps = sortedEvents.map((event) => event.occurredAt);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);

  return {
    providerName: 'kucoin',
    correlationKey,
    events: sortedEvents,
    evidence: {
      sharedKeys: sortedEvents.flatMap((event) => event.providerHints.correlationKeys),
      assetSymbols: Array.from(new Set(sortedEvents.flatMap(getEvidenceAssetSymbols))),
      directionHints: sortedEvents.map((event) => event.providerHints.directionHint ?? 'unknown'),
      timeSpanMs: maxTimestamp - minTimestamp,
    },
  } satisfies ExchangeCorrelationGroup;
}

function isTransferAccountHistoryEvent(event: ExchangeProviderEvent): boolean {
  const metadata = getMetadata(event);
  return metadata.rowKind === 'account_history' && metadata.type === 'transfer';
}

function buildTransferPairingKey(event: ExchangeProviderEvent): string {
  const metadata = getMetadata(event);
  if (metadata.rowKind !== 'account_history' || metadata.type !== 'transfer') {
    throw new Error(`Expected KuCoin transfer account-history metadata for event ${event.providerEventId}`);
  }

  const normalizedRemark = metadata.remark?.trim().toLowerCase() ?? '';
  const normalizedAmount = parseDecimal(event.rawAmount).abs().toFixed();
  return `${event.assetSymbol}|${normalizedAmount}|${normalizedRemark}`;
}

function buildRegularCorrelationGroups(events: readonly ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
  const grouped = new Map<string, ExchangeProviderEvent[]>();

  for (const event of events) {
    const correlationKey = event.providerHints.correlationKeys[0] ?? event.providerEventId;
    const existing = grouped.get(correlationKey);

    if (existing) {
      existing.push(event);
      continue;
    }

    grouped.set(correlationKey, [event]);
  }

  return Array.from(grouped.entries()).map(([correlationKey, groupEvents]) =>
    createCorrelationGroup(correlationKey, groupEvents)
  );
}

function buildTransferAccountHistoryGroups(events: readonly ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
  const sortedEvents = [...events].sort((left, right) => left.occurredAt - right.occurredAt);
  const pendingByPairingKeyAndSide = new Map<string, ExchangeProviderEvent[]>();
  const groups: ExchangeCorrelationGroup[] = [];

  for (const event of sortedEvents) {
    const metadata = getMetadata(event);
    if (metadata.rowKind !== 'account_history' || metadata.type !== 'transfer') {
      continue;
    }

    const pairingKey = buildTransferPairingKey(event);
    const opposingSide = metadata.side === 'credit' ? 'debit' : 'credit';
    const opposingQueueKey = `${pairingKey}|${opposingSide}`;
    const opposingQueue = pendingByPairingKeyAndSide.get(opposingQueueKey) ?? [];

    while (
      opposingQueue.length > 0 &&
      event.occurredAt - (opposingQueue[0]?.occurredAt ?? event.occurredAt) > ACCOUNT_HISTORY_TRANSFER_PAIRING_WINDOW_MS
    ) {
      const expiredEvent = opposingQueue.shift();
      if (!expiredEvent) {
        break;
      }

      groups.push(
        createCorrelationGroup(expiredEvent.providerHints.correlationKeys[0] ?? expiredEvent.providerEventId, [
          expiredEvent,
        ])
      );
    }

    if (opposingQueue.length === 0) {
      pendingByPairingKeyAndSide.delete(opposingQueueKey);
    } else {
      pendingByPairingKeyAndSide.set(opposingQueueKey, opposingQueue);
    }

    const matchedEvent = opposingQueue.pop();
    if (matchedEvent) {
      if (opposingQueue.length === 0) {
        pendingByPairingKeyAndSide.delete(opposingQueueKey);
      } else {
        pendingByPairingKeyAndSide.set(opposingQueueKey, opposingQueue);
      }

      groups.push(
        createCorrelationGroup(`transfer:${matchedEvent.providerEventId}:${event.providerEventId}`, [
          matchedEvent,
          event,
        ])
      );
      continue;
    }

    const sameSideQueueKey = `${pairingKey}|${metadata.side}`;
    const sameSideQueue = pendingByPairingKeyAndSide.get(sameSideQueueKey) ?? [];
    sameSideQueue.push(event);
    pendingByPairingKeyAndSide.set(sameSideQueueKey, sameSideQueue);
  }

  for (const pendingEvents of pendingByPairingKeyAndSide.values()) {
    for (const pendingEvent of pendingEvents) {
      groups.push(
        createCorrelationGroup(pendingEvent.providerHints.correlationKeys[0] ?? pendingEvent.providerEventId, [
          pendingEvent,
        ])
      );
    }
  }

  return groups;
}

function sortCorrelationGroups(groups: readonly ExchangeCorrelationGroup[]): ExchangeCorrelationGroup[] {
  return [...groups].sort((left, right) => {
    const leftTimestamp = left.events[0]?.occurredAt ?? 0;
    const rightTimestamp = right.events[0]?.occurredAt ?? 0;

    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    return left.correlationKey.localeCompare(right.correlationKey);
  });
}

export function buildKuCoinCorrelationGroups(events: ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
  const transferAccountHistoryEvents = events.filter(isTransferAccountHistoryEvent);
  const regularEvents = events.filter((event) => !isTransferAccountHistoryEvent(event));

  return sortCorrelationGroups([
    ...buildRegularCorrelationGroups(regularEvents),
    ...buildTransferAccountHistoryGroups(transferAccountHistoryEvents),
  ]);
}
