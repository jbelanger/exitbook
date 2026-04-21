import { buildExchangeCorrelationGroups } from '../shared/build-exchange-correlation-groups.js';
import type { ExchangeCorrelationGroup } from '../shared/index.js';

import type { CoinbaseProviderEvent, CoinbaseProviderMetadata } from './normalize-provider-event.js';

export function buildCoinbaseCorrelationGroups(
  events: CoinbaseProviderEvent[]
): ExchangeCorrelationGroup<CoinbaseProviderMetadata>[] {
  return buildExchangeCorrelationGroups(events, 'coinbase');
}
