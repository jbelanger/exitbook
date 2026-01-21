import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';

/**
 * Normalize XRP address
 * XRP addresses are case-sensitive base58 encoded starting with 'r'
 * No transformation needed, just validation
 */
export function normalizeXrpAddress(address: string): string {
  // XRP addresses are already in their canonical form
  // Just trim whitespace and return
  return address.trim();
}

/**
 * Validate XRP address format
 * Must start with 'r' and be 25-35 characters (base58 encoded)
 */
export function isValidXrpAddress(address: string): boolean {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}

/**
 * Convert drops to XRP decimal string using Decimal for precision
 * 1 XRP = 1,000,000 drops (6 decimal places)
 */
export function dropsToXrpDecimalString(drops: string | number): string {
  return parseDecimal(drops.toString()).div(parseDecimal('10').pow(6)).toFixed();
}

/**
 * Convert XRP to drops using Decimal for precision
 * 1 XRP = 1,000,000 drops (6 decimal places)
 * Truncates (rounds down) to ensure we don't exceed available balance
 */
export function xrpToDrops(xrp: string | number): string {
  return parseDecimal(xrp.toString()).mul(parseDecimal('10').pow(6)).toFixed(0, Decimal.ROUND_DOWN);
}

/**
 * Convert Ripple epoch timestamp to Unix timestamp
 * Ripple epoch: January 1, 2000 (00:00 UTC)
 * Offset: 946684800 seconds
 */
export function rippleTimeToUnix(rippleTime: number): number {
  const RIPPLE_EPOCH_OFFSET = 946684800;
  return rippleTime + RIPPLE_EPOCH_OFFSET;
}

/**
 * Convert Unix timestamp to Ripple epoch timestamp
 */
export function unixToRippleTime(unixTime: number): number {
  const RIPPLE_EPOCH_OFFSET = 946684800;
  return unixTime - RIPPLE_EPOCH_OFFSET;
}
