import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

/**
 * Converts a balance from smallest units (wei) to decimal using the specified decimals.
 *
 * @param balanceWei - Balance in smallest units (wei)
 * @param decimals - Number of decimal places (18 for ETH)
 * @returns Balance as a decimal string
 */
export function convertWeiToDecimal(balanceWei: string, decimals: number): string {
  return parseDecimal(balanceWei).div(parseDecimal('10').pow(decimals)).toString();
}

/**
 * Converts a decimal balance to smallest units (wei).
 *
 * @param balanceDecimal - Balance as a decimal
 * @param decimals - Number of decimal places (18 for ETH)
 * @returns Balance in smallest units as a Decimal
 */
export function convertDecimalToWei(balanceDecimal: string | Decimal, decimals: number): Decimal {
  const decimal = typeof balanceDecimal === 'string' ? parseDecimal(balanceDecimal) : balanceDecimal;
  return decimal.mul(parseDecimal('10').pow(decimals));
}

/**
 * Filters balances to find the native token (address is null or zero address).
 *
 * @param tokenAddress - The token's contract address
 * @returns True if this is a native token, false otherwise
 */
export function isNativeToken(tokenAddress: string | null | undefined): boolean {
  if (!tokenAddress) {
    return true;
  }
  return tokenAddress === '0x0000000000000000000000000000000000000000' || tokenAddress === '0x0';
}

/**
 * Filters an array of token balances to exclude zero balances.
 *
 * @param balances - Array of objects with tokenBalance property
 * @returns Filtered array excluding zero balances
 */
export function filterNonZeroBalances<T extends { tokenBalance: string }>(balances: T[]): T[] {
  return balances.filter((b) => b.tokenBalance !== '0');
}

/**
 * Filters token balances by contract addresses.
 *
 * @param balances - Array of objects with tokenAddress property
 * @param contractAddresses - Array of contract addresses to filter by
 * @returns Filtered array containing only specified contracts
 */
export function filterByContractAddresses<T extends { tokenAddress: string | null }>(
  balances: T[],
  contractAddresses: string[]
): T[] {
  return balances.filter((balance) => balance.tokenAddress && contractAddresses.includes(balance.tokenAddress));
}
