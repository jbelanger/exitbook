import path from 'node:path';

import { ManualPriceService } from '../services/manual-price-service.js';

/**
 * Host-facing factory for ManualPriceService.
 *
 * Encapsulates the provider-owned database path so hosts don't need
 * to know that prices live in `prices.db`.
 */
export function createManualPriceService(dataDir: string): ManualPriceService {
  return new ManualPriceService(path.join(dataDir, 'prices.db'));
}
