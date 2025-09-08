import { Data } from 'effect';

export type CurrencySymbol = string & { readonly __brand: 'CurrencySymbol' };
export const CurrencySymbol = (value: string): CurrencySymbol => value as CurrencySymbol;

export interface Currency {
  readonly _tag: 'Currency';
  readonly decimals: number;
  readonly name: string;
  readonly symbol: CurrencySymbol;
}

export const Currency = Data.tagged<Currency>('Currency');

// Common currencies
export const USD = Currency({
  decimals: 2,
  name: 'US Dollar',
  symbol: CurrencySymbol('USD'),
});

export const EUR = Currency({
  decimals: 2,
  name: 'Euro',
  symbol: CurrencySymbol('EUR'),
});

export const BTC = Currency({
  decimals: 8,
  name: 'Bitcoin',
  symbol: CurrencySymbol('BTC'),
});

export const ETH = Currency({
  decimals: 18,
  name: 'Ethereum',
  symbol: CurrencySymbol('ETH'),
});
