import type { ExchangeCorrelationGroup, ExchangeProviderEvent, ExchangeProviderMetadata } from './index.js';

/**
 * Group exchange events into correlation groups by their correlation key.
 *
 * @param events - Raw provider events to group
 * @param providerName - Exchange name embedded in each group
 * @param sortGroupsByKey - When true, applies a secondary sort by correlationKey after timestamp
 */
export function buildExchangeCorrelationGroups<TProviderMetadata extends ExchangeProviderMetadata>(
  events: ExchangeProviderEvent<TProviderMetadata>[],
  providerName: string,
  sortGroupsByKey = false
): ExchangeCorrelationGroup<TProviderMetadata>[] {
  const grouped = new Map<string, ExchangeProviderEvent<TProviderMetadata>[]>();

  for (const event of events) {
    const correlationKey = event.providerHints.correlationKeys[0] ?? event.providerEventId;
    const existing = grouped.get(correlationKey);

    if (existing) {
      existing.push(event);
      continue;
    }

    grouped.set(correlationKey, [event]);
  }

  const groups = Array.from(grouped.entries()).map(([correlationKey, groupEvents]) => {
    const sortedEvents = [...groupEvents].sort((left, right) => left.occurredAt - right.occurredAt);
    const timestamps = sortedEvents.map((event) => event.occurredAt);
    const minTimestamp = Math.min(...timestamps);
    const maxTimestamp = Math.max(...timestamps);

    return {
      providerName,
      correlationKey,
      events: sortedEvents,
      evidence: {
        sharedKeys: sortedEvents.flatMap((event) => event.providerHints.correlationKeys),
        assetSymbols: Array.from(new Set(sortedEvents.map((event) => event.assetSymbol))),
        directionHints: sortedEvents.map((event) => event.providerHints.directionHint ?? 'unknown'),
        timeSpanMs: maxTimestamp - minTimestamp,
      },
    } satisfies ExchangeCorrelationGroup<TProviderMetadata>;
  });

  if (!sortGroupsByKey) {
    return groups;
  }

  return groups.sort((left, right) => {
    const leftTimestamp = left.events[0]?.occurredAt ?? 0;
    const rightTimestamp = right.events[0]?.occurredAt ?? 0;

    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    return left.correlationKey.localeCompare(right.correlationKey);
  });
}
