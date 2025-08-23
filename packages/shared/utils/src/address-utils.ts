/**
 * Address utility functions for blockchain operations
 */

/**
 * Mask an address for logging to protect privacy
 * Shows first 4 and last 4 characters for addresses longer than 8 characters
 * Includes null/undefined safety check
 *
 * @param address The address to mask
 * @returns The masked address string
 *
 * @example
 * maskAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa') // '1A1z...fNa'
 * maskAddress('short') // 'short'
 * maskAddress('') // ''
 * maskAddress(null) // ''
 */
export function maskAddress(address: string | null | undefined): string {
  if (!address || address.length <= 8) return address || "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
