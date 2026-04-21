import type { ExchangeProviderEvent, ExchangeProviderMetadata } from './exchange-provider-event.js';

export interface ExchangeCorrelationGroup<
  TProviderMetadata extends ExchangeProviderMetadata = ExchangeProviderMetadata,
> {
  providerName: string;
  correlationKey: string;
  events: ExchangeProviderEvent<TProviderMetadata>[];
  evidence: {
    assetSymbols: string[];
    directionHints: ('credit' | 'debit' | 'unknown')[];
    sharedKeys: string[];
    timeSpanMs: number;
  };
}
