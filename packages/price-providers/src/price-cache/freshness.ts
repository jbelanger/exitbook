import path from 'node:path';

import type { Result } from '@exitbook/core';

import { readLatestPriceMutationAt } from './persistence/watermark.js';

/**
 * Host-facing API for price-cache freshness.
 *
 * Accepts a data directory and internally resolves the provider-owned
 * database path, so hosts don't need to know about `prices.db`.
 */
export async function readPriceCacheFreshness(dataDir: string): Promise<Result<Date | undefined, Error>> {
  return readLatestPriceMutationAt(path.join(dataDir, 'prices.db'));
}
