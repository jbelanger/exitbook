import type { RawTransaction } from '@exitbook/core';

/**
 * Extract unique account IDs from raw data items.
 *
 * @param rawData - Array of raw transaction data items
 * @returns Array of unique account IDs
 */
export function extractUniqueAccountIds(rawData: RawTransaction[]): number[] {
  return [...new Set(rawData.map((item) => item.accountId))];
}
