import type { Result } from '@exitbook/core';
import { ok, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../persistence/database.js';

const logger = getLogger('PriceCachePersistence');

/**
 * Initialize the provider-owned price cache database.
 */
export async function initPriceCacheDatabase(databasePath: string): Promise<Result<PricesDB, Error>> {
  const dbResult = createPricesDatabase(databasePath);
  if (dbResult.isErr()) {
    return wrapError(dbResult.error, 'Failed to create prices database');
  }

  const db = dbResult.value;

  const migrationResult = await initializePricesDatabase(db);
  if (migrationResult.isErr()) {
    return wrapError(migrationResult.error, 'Failed to initialize prices database');
  }

  logger.debug({ databasePath }, 'Price cache database initialized');

  return ok(db);
}
