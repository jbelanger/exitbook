import type { ExchangeCorrelationGroup, ExchangeProviderEvent } from '../shared/index.js';

export function buildKrakenCorrelationGroups(events: ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
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
        providerName: 'kraken',
        correlationKey,
        events: sortedEvents,
        evidence: {
          sharedKeys: sortedEvents.flatMap((event) => event.providerHints.correlationKeys),
          assetSymbols: Array.from(new Set(sortedEvents.map((event) => event.assetSymbol))),
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
