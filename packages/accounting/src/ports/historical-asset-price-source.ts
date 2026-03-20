import type { Currency } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

export type HistoricalAssetPriceGranularity = 'exact' | 'minute' | 'hour' | 'day';

export interface HistoricalAssetPriceRequest {
  assetSymbol: Currency;
  timestamp: Date;
  currency: Currency;
}

export interface HistoricalAssetPrice {
  assetSymbol: Currency;
  timestamp: Date;
  price: Decimal;
  currency: Currency;
  source: string;
  fetchedAt: Date;
  granularity?: HistoricalAssetPriceGranularity | undefined;
}

export interface IHistoricalAssetPriceSource {
  fetchPrice(query: HistoricalAssetPriceRequest): Promise<Result<HistoricalAssetPrice, Error>>;
}
