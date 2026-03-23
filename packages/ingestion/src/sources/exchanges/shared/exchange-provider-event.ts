import type { TransactionStatus } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';

export interface ExchangeProviderEvent {
  providerEventId: string;
  providerName: string;
  providerType: string;
  occurredAt: number;
  status: TransactionStatus;
  assetSymbol: Currency;
  rawAmount: string;
  rawFee?: string | undefined;
  rawFeeCurrency?: Currency | undefined;
  providerHints: {
    addressHint?: string | undefined;
    correlationKeys: string[];
    directionHint?: 'credit' | 'debit' | 'unknown' | undefined;
    hashHint?: string | undefined;
    networkHint?: string | undefined;
  };
  providerMetadata: Record<string, unknown>;
}
