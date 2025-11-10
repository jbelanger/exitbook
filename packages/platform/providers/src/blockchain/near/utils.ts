import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

/**
 * NEAR account ID validation
 * Validates both implicit accounts (64-char hex) and named accounts
 */
export function isValidNearAccountId(accountId: string): boolean {
  // Must be between 2-64 characters
  if (accountId.length < 2 || accountId.length > 64) {
    return false;
  }

  // Check for implicit account (must be exactly 64-character hex string)
  if (accountId.length === 64) {
    // If it's 64 chars, it must be valid hex (implicit account)
    return /^[0-9a-f]{64}$/.test(accountId);
  }

  // If it's close to 64 chars and all hex, it's likely a malformed implicit account
  if (accountId.length >= 60 && /^[0-9a-f]+$/.test(accountId)) {
    return false;
  }

  // For other strings, check if it's a valid named account
  // Named accounts: lowercase alphanumeric, _, -, .
  return /^[a-z0-9_.-]+$/.test(accountId);
}

/**
 * Convert yoctoNEAR (10^-24 NEAR) to NEAR
 * 1 NEAR = 10^24 yoctoNEAR
 */
export function yoctoNearToNear(yoctoNear: number | string): Decimal {
  return parseDecimal(yoctoNear.toString()).dividedBy(parseDecimal('10').pow(24));
}

/**
 * Convert NEAR to yoctoNEAR
 */
export function nearToYoctoNear(near: number | string): Decimal {
  return parseDecimal(near.toString()).mul(parseDecimal('10').pow(24));
}

/**
 * Format NEAR account ID for display (no transformation, NEAR accounts are case-sensitive)
 */
export function formatNearAccountId(accountId: string): string {
  return accountId;
}

/**
 * Convert yoctoNEAR to NEAR as a string
 * 1 NEAR = 10^24 yoctoNEAR
 */
export function yoctoNearToNearString(yoctoNear: string | number): string {
  return parseDecimal(yoctoNear.toString()).div(parseDecimal('10').pow(24)).toFixed();
}
