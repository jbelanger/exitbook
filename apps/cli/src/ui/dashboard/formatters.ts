/**
 * Format elapsed time as mm:ss.
 */
export function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

/**
 * Format timestamp as HH:MM:SS AM/PM.
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * Format number with thousands separators.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format address/hash with truncation (e.g., 0xd8da...9d7e).
 */
export function formatAddress(address: string, prefixLength = 6, suffixLength = 4): string {
  if (address.length <= prefixLength + suffixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

/**
 * Calculate cache hit rate percentage.
 */
export function calculateHitRate(hits: number, misses: number): string {
  const total = hits + misses;
  if (total === 0) return '0';
  return ((hits / total) * 100).toFixed(0);
}
