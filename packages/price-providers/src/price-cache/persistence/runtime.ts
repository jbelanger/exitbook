import type { Result } from '@exitbook/core';
import { err, ok, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import { closePricesDatabase, createPricesDatabase, initializePricesDatabase, type PricesDB } from './database.js';
import { createPriceQueries, type PriceQueries } from './queries.js';

const logger = getLogger('PriceCachePersistence');

export interface PriceCachePersistence {
  database: PricesDB;
  queries: PriceQueries;
  cleanup: () => Promise<void>;
}

/**
 * Initialize the provider-owned price cache database.
 */
export async function initPriceCachePersistence(databasePath: string): Promise<Result<PriceCachePersistence, Error>> {
  const dbResult = createPricesDatabase(databasePath);
  if (dbResult.isErr()) {
    return wrapError(dbResult.error, 'Failed to create prices database');
  }

  const database = dbResult.value;

  const migrationResult = await initializePricesDatabase(database);
  if (migrationResult.isErr()) {
    const closeResult = await closePricesDatabase(database);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close prices database after initialization failure');
    }

    return err(migrationResult.error);
  }

  const queries = createPriceQueries(database);
  const cleanup = async () => {
    const closeResult = await closePricesDatabase(database);
    if (closeResult.isErr()) {
      throw closeResult.error;
    }
  };

  logger.debug({ databasePath }, 'Price cache persistence initialized');

  return ok({
    database,
    queries,
    cleanup,
  });
}
