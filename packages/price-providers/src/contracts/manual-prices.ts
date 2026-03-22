import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

/**
 * Manual price entry data.
 */
export interface ManualPriceEntry {
  assetSymbol: Currency;
  date: Date;
  price: Decimal;
  currency?: Currency | undefined;
  source?: string | undefined;
}

/**
 * Manual FX rate entry data.
 */
export interface ManualFxRateEntry {
  from: Currency;
  to: Currency;
  date: Date;
  rate: Decimal;
  source?: string | undefined;
}
