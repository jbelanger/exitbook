import type { ExchangeProviderEvent } from './exchange-provider-event.js';

export interface ExchangeCorrelationGroup {
  providerName: string;
  correlationKey: string;
  events: ExchangeProviderEvent[];
  evidence: {
    assetSymbols: string[];
    directionHints: ('credit' | 'debit' | 'unknown')[];
    sharedKeys: string[];
    timeSpanMs: number;
  };
}
