/**
 * Mask an address for logging to protect privacy.
 */
export function maskAddress(address: string | null | undefined): string {
  if (!address || address.length <= 8) {
    return address || '';
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
