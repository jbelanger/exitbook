import { Decimal } from 'decimal.js';

/**
 * Validate NEAR account ID format
 *
 * NEAR uses human-readable account IDs with specific format requirements:
 * - 2-64 characters long (or 1 for system accounts)
 * - Contains only: lowercase letters (a-z), digits (0-9), underscores (_), hyphens (-), dots (.)
 * - Implicit accounts: 64-character hex strings
 * - Named accounts: account.near, sub.account.near
 * - System accounts: system, near
 *
 * @param accountId - Account ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidNearAccountId(accountId: string): boolean {
  if (!accountId || accountId.length === 0 || accountId.length > 64) {
    return false;
  }

  // Allow implicit accounts (64 character hex strings)
  if (/^[0-9a-f]{64}$/.test(accountId)) {
    return true;
  }

  // Validate named accounts (lowercase letters, digits, underscores, hyphens, dots)
  return /^[a-z0-9_.-]+$/.test(accountId);
}

/**
 * Extract fee information from receipt outcome
 *
 * @param tokensBurntYocto - Fee amount in yoctoNEAR (from receipt outcome)
 * @param predecessorId - The account that pays for this receipt's execution
 * @returns Fee object or undefined if no fee
 */
export function extractReceiptFee(params: {
  predecessorId: string;
  tokensBurntYocto?: string;
}): { amountYocto: string; payer: string } | undefined {
  if (!params.tokensBurntYocto || new Decimal(params.tokensBurntYocto).isZero()) {
    return undefined;
  }

  return {
    amountYocto: params.tokensBurntYocto,
    payer: params.predecessorId, // Predecessor pays for receipt execution
  };
}
