/**
 * Pure functions for Cosmos transaction mapping and normalization
 *
 * These functions handle transaction relevance detection, denom formatting,
 * and unique identifier generation for Cosmos SDK-based chains.
 */
import { parseDecimal } from '@exitbook/core';

/**
 * Check if a transaction is relevant to the given address
 *
 * A transaction is relevant if:
 * - The address is the recipient (to) and amount > 0
 * - The address is the sender (from) and amount > 0
 *
 * @param from - Sender address
 * @param to - Recipient address
 * @param relevantAddress - Address to check relevance for
 * @param amount - Transaction amount
 * @returns True if transaction is relevant, false otherwise
 *
 * @example
 * ```typescript
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1xyz", "1.5") // true (receiving)
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1abc", "1.5") // true (sending)
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1def", "1.5") // false (not involved)
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1xyz", "0")   // false (zero amount)
 * ```
 */
export function isTransactionRelevant(from: string, to: string, relevantAddress: string, amount: string): boolean {
  const amountValue = parseDecimal(amount).toNumber();

  if (amountValue <= 0) {
    return false;
  }

  if (to && relevantAddress === to) {
    return true;
  }

  if (from && relevantAddress === from) {
    return true;
  }

  return false;
}

/**
 * Format and normalize denomination strings
 *
 * Converts Injective-specific denominations to standard format:
 * - "inj" → "INJ"
 * - "uinj" → "INJ"
 * - Other denoms → UPPERCASE
 * - undefined → "INJ" (default)
 *
 * @param denom - Denomination string to format
 * @returns Formatted denomination
 *
 * @example
 * ```typescript
 * formatDenom("inj")     // "INJ"
 * formatDenom("uinj")    // "INJ"
 * formatDenom("usdc")    // "USDC"
 * formatDenom(undefined) // "INJ"
 * ```
 */
export function formatDenom(denom: string | undefined): string {
  if (!denom) {
    return 'INJ';
  }

  if (denom === 'inj' || denom === 'uinj') {
    return 'INJ';
  }

  return denom.toUpperCase();
}

/**
 * Generate unique Peggy bridge transaction identifier
 *
 * For Peggy bridge deposits, multiple validators submit the same deposit claim
 * as separate blockchain transactions. Use event_nonce to deduplicate these.
 * Falls back to claim_id from transaction level if event_nonce is not available.
 *
 * @param eventNonce - Event nonce from message (preferred for deduplication)
 * @param claimId - Claim ID from transaction level (fallback)
 * @param transactionHash - Original transaction hash (final fallback)
 * @returns Unique identifier for the transaction
 *
 * @example
 * ```typescript
 * generatePeggyId("12345", [1, 2], "0xabc")  // "peggy-deposit-12345"
 * generatePeggyId(undefined, [67], "0xabc")  // "peggy-deposit-67"
 * generatePeggyId(undefined, [], "0xabc")    // "0xabc"
 * ```
 */
export function generatePeggyId(
  eventNonce: string | undefined,
  claimId: number[] | undefined,
  transactionHash: string
): string {
  if (eventNonce) {
    return `peggy-deposit-${eventNonce}`;
  }

  if (claimId && Array.isArray(claimId) && claimId.length > 0) {
    return `peggy-deposit-${String(claimId[0])}`;
  }

  return transactionHash;
}
