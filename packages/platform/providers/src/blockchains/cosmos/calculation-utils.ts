/**
 * Pure functions for Cosmos transaction calculations
 *
 * These functions handle fee and amount calculations for Cosmos SDK-based chains.
 * All calculations use Decimal.js for precision-safe arithmetic.
 */
import { parseDecimal } from '@exitbook/core';

import type { InjectiveGasFee, InjectiveAmount } from './providers/injective-explorer/injective-explorer.schemas.js';

/**
 * Result of fee calculation
 */
export interface FeeCalculationResult {
  feeAmount: string;
  feeCurrency: string;
}

/**
 * Result of amount conversion
 */
export interface AmountConversionResult {
  amount: string;
  currency: string;
}

/**
 * Calculate transaction fee from Injective gas fee structure
 *
 * Extracts the fee amount and currency from the gas_fee field.
 * Converts from smallest unit (e.g., 10^-18) to main unit.
 *
 * @param gasFee - Gas fee structure from transaction
 * @param decimals - Number of decimals for the chain (default: 18 for Injective)
 * @returns Fee amount and currency, or undefined if no fee
 *
 * @example
 * ```typescript
 * const fee = calculateFee({ amount: [{ amount: "1000000000000000000", denom: "inj" }], gas_limit: 100000 });
 * // Returns { feeAmount: "1.0", feeCurrency: "INJ" }
 * ```
 */
export function calculateFee(gasFee: InjectiveGasFee | undefined, decimals = 18): FeeCalculationResult | undefined {
  if (!gasFee?.amount?.length) {
    return undefined;
  }

  const firstFee = gasFee.amount[0];
  if (!firstFee?.amount || !firstFee.denom) {
    return undefined;
  }

  const feeAmount = parseDecimal(firstFee.amount).div(Math.pow(10, decimals)).toFixed();

  return {
    feeAmount,
    feeCurrency: firstFee.denom,
  };
}

/**
 * Convert amount from smallest unit to main unit
 *
 * @param amountData - Amount structure with amount and denom
 * @param decimals - Number of decimals for conversion (default: 18)
 * @returns Converted amount and currency
 *
 * @example
 * ```typescript
 * const amount = convertAmount({ amount: "1000000000000000000", denom: "inj" });
 * // Returns { amount: "1.0", currency: "inj" }
 * ```
 */
export function convertAmount(amountData: InjectiveAmount, decimals = 18): AmountConversionResult {
  const amount = parseDecimal(amountData.amount).div(Math.pow(10, decimals)).toFixed();

  return {
    amount,
    currency: amountData.denom,
  };
}

/**
 * Convert amount from array of amounts (takes first element)
 *
 * @param amounts - Array of amount structures
 * @param decimals - Number of decimals for conversion (default: 18)
 * @returns Converted amount and currency, or undefined if array is empty
 */
export function convertAmountFromArray(
  amounts: InjectiveAmount[] | undefined,
  decimals = 18
): AmountConversionResult | undefined {
  if (!amounts?.length) {
    return undefined;
  }

  const firstAmount = amounts[0];
  if (!firstAmount) {
    return undefined;
  }

  return convertAmount(firstAmount, decimals);
}
