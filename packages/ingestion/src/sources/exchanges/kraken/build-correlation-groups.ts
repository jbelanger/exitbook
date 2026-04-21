import { buildExchangeCorrelationGroups } from '../shared/build-exchange-correlation-groups.js';
import type { ExchangeCorrelationGroup } from '../shared/index.js';

import type { KrakenProviderEvent, KrakenProviderMetadata } from './normalize-provider-event.js';

export function buildKrakenCorrelationGroups(
  events: KrakenProviderEvent[]
): ExchangeCorrelationGroup<KrakenProviderMetadata>[] {
  return buildExchangeCorrelationGroups(events, 'kraken', true);
}
