import { buildExchangeCorrelationGroups } from '../shared/build-exchange-correlation-groups.js';
import type { ExchangeCorrelationGroup, ExchangeProviderEvent } from '../shared/index.js';

export function buildKrakenCorrelationGroups(events: ExchangeProviderEvent[]): ExchangeCorrelationGroup[] {
  return buildExchangeCorrelationGroups(events, 'kraken', true);
}
