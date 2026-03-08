import type { ExchangeCorrelationGroup, ExchangeProviderEvent } from '../shared-v2/index.js';

export function buildCoinbaseCorrelationGroups(events: ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
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

  return Array.from(grouped.entries()).map(([correlationKey, groupEvents]) => {
    const eventsSorted = [...groupEvents].sort((left, right) => left.occurredAt - right.occurredAt);
    const timestamps = eventsSorted.map((event) => event.occurredAt);
    const minTimestamp = Math.min(...timestamps);
    const maxTimestamp = Math.max(...timestamps);

    return {
      providerName: 'coinbase',
      correlationKey,
      events: eventsSorted,
      evidence: {
        sharedKeys: eventsSorted.flatMap((event) => event.providerHints.correlationKeys),
        assetSymbols: Array.from(new Set(eventsSorted.map((event) => event.assetSymbol))),
        directionHints: eventsSorted.map((event) => event.providerHints.directionHint ?? 'unknown'),
        timeSpanMs: maxTimestamp - minTimestamp,
      },
    } satisfies ExchangeCorrelationGroup;
  });
}
