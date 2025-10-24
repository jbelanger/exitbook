/**
 * Normalize EVM address to lowercase for consistent storage and comparison.
 * EVM addresses are case-insensitive (checksummed addresses are for validation only).
 *
 * @param address - The EVM address (0x...)
 * @returns Lowercase address, or undefined if input is undefined/null
 */
export function normalizeEvmAddress(address: string | null | undefined): string | undefined {
  if (!address) {
    return undefined;
  }
  return address.toLowerCase();
}
