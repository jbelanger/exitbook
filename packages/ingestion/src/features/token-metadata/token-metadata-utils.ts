/**
 * Check if a string looks like a token contract address vs a readable symbol.
 * Useful for determining when to enrich token data.
 *
 * @param value - String to check
 * @param minLength - Minimum length for address (default 32 for Solana, 40+ for EVM)
 * @returns true if value looks like an address
 */
export function looksLikeContractAddress(value: string, minLength = 32): boolean {
  if (value.length < minLength) {
    return false;
  }

  // Addresses contain hex (for EVM) or base58 (for Solana), so they should have numbers
  // Human-readable symbols are typically all letters, even if long
  const hasNumbers = /\d/.test(value);

  return hasNumbers;
}
