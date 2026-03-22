import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export const THETA_GAS_ASSET_SYMBOL = 'TFUEL';
export const THETA_PRIMARY_ASSET_SYMBOL = 'THETA';
export const THETA_NATIVE_DECIMALS = 18;

export function parseCommaFormattedNumber(value: string): Decimal {
  return parseDecimal(value.replace(/,/g, ''));
}

export function selectThetaCurrency(
  thetaAmount: Decimal,
  tfuelAmount: Decimal
): { amount: Decimal; currency: typeof THETA_GAS_ASSET_SYMBOL | typeof THETA_PRIMARY_ASSET_SYMBOL } {
  if (thetaAmount.gt(0)) {
    return { currency: THETA_PRIMARY_ASSET_SYMBOL, amount: thetaAmount };
  }

  if (tfuelAmount.gt(0)) {
    return { currency: THETA_GAS_ASSET_SYMBOL, amount: tfuelAmount };
  }

  return { currency: THETA_GAS_ASSET_SYMBOL, amount: parseDecimal('0') };
}

export function isThetaTokenTransfer(currency: string): boolean {
  return currency === THETA_PRIMARY_ASSET_SYMBOL;
}

export function formatThetaAmount(
  amount: Decimal,
  isThetaTransfer: boolean,
  decimals: number = THETA_NATIVE_DECIMALS
): string {
  return isThetaTransfer ? amount.dividedBy(parseDecimal('10').pow(decimals)).toFixed() : amount.toFixed(0);
}
