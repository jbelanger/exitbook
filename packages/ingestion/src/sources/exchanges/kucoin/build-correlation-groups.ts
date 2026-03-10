import type { ExchangeCorrelationGroup, ExchangeProviderEvent } from '../shared-v2/index.js';

import type { KucoinProviderMetadata } from './normalize-provider-event.js';

function getMetadata(event: ExchangeProviderEvent): KucoinProviderMetadata {
  return event.providerMetadata as KucoinProviderMetadata;
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

export function buildKucoinCorrelationGroups(events: ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
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

  return Array.from(grouped.entries())
    .map(([correlationKey, groupEvents]) => {
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
    })
    .sort((left, right) => {
      const leftTimestamp = left.events[0]?.occurredAt ?? 0;
      const rightTimestamp = right.events[0]?.occurredAt ?? 0;

      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }

      return left.correlationKey.localeCompare(right.correlationKey);
    });
}
