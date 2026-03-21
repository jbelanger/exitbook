import path from 'node:path';

import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import {
  closeProviderStatsDatabase,
  createProviderStatsDatabase,
  initializeProviderStatsDatabase,
  type ProviderStatsDB,
} from './database.js';
import { createProviderStatsQueries, type ProviderStatsQueries } from './queries.js';

const logger = getLogger('ProviderStatsPersistence');

export interface ProviderStatsPersistence {
  database: ProviderStatsDB;
  queries: ProviderStatsQueries;
  cleanup: () => Promise<void>;
}

/**
 * Initialize provider stats persistence backed by providers.db.
 */
export async function initProviderStatsPersistence(dataDir: string): Promise<Result<ProviderStatsPersistence, Error>> {
  const dbPath = path.join(dataDir, 'providers.db');
  const dbResult = createProviderStatsDatabase(dbPath);
  if (dbResult.isErr()) {
    return err(dbResult.error);
  }

  const database = dbResult.value;
  const migrationResult = await initializeProviderStatsDatabase(database);
  if (migrationResult.isErr()) {
    logger.warn({ error: migrationResult.error }, 'Provider stats migration failed');

    const closeResult = await closeProviderStatsDatabase(database);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close provider stats database after migration failure');
    }

    return err(migrationResult.error);
  }

  const queries = createProviderStatsQueries(database);
  const cleanup = async () => {
    const closeResult = await closeProviderStatsDatabase(database);
    if (closeResult.isErr()) {
      throw closeResult.error;
    }
  };

  return ok({
    database,
    queries,
    cleanup,
  });
}
