import { buildExchangeCorrelationGroups } from '../shared/build-exchange-correlation-groups.js';
import type { ExchangeCorrelationGroup, ExchangeProviderEvent } from '../shared/index.js';

export function buildCoinbaseCorrelationGroups(events: ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
  return buildExchangeCorrelationGroups(events, 'coinbase');
}
