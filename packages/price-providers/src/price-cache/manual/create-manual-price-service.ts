import path from 'node:path';

import { ManualPriceService } from './service.js';

/**
 * Factory for ManualPriceService.
 *
 * Encapsulates the provider-owned database path so consumers do not need to know
 * that manual prices live in `prices.db`.
 */
export function createManualPriceService(dataDir: string): ManualPriceService {
  return new ManualPriceService(path.join(dataDir, 'prices.db'));
}
