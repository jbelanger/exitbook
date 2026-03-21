import path from 'node:path';

import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import {
  closeProviderStatsDatabase,
  createProviderStatsDatabase,
  initializeProviderStatsDatabase,
  type ProviderStatsDB,
} from './persistence/database.js';
import { createProviderStatsQueries, type ProviderStatsQueries } from './persistence/queries.js';

const logger = getLogger('ProviderStatsPersistence');

export { ProviderHealthMonitor } from './health-monitor.js';
export {
  getProviderKey,
  parseProviderKey,
  ProviderStatsStore,
  type ProviderKey,
  type ProviderStatsStoreOptions,
} from './store.js';
export {
  closeProviderStatsDatabase,
  createProviderStatsDatabase,
  initializeProviderStatsDatabase,
  type ProviderStatsDB,
} from './persistence/database.js';
export { hydrateProviderStats, type HydratedProviderStats, type ProviderStatsRow } from './persistence/utils.js';
export {
  createProviderStatsQueries,
  type ProviderStatsInput,
  type ProviderStatsQueries,
} from './persistence/queries.js';
export type { ProviderStatsDatabase } from './persistence/schema.js';

export interface ProviderStatsPersistenceDeps {
  database: ProviderStatsDB;
  queries: ProviderStatsQueries;
  cleanup: () => Promise<void>;
}

/**
 * Create provider stats persistence dependencies backed by providers.db.
 */
export async function createProviderStatsPersistence(
  dataDir: string
): Promise<Result<ProviderStatsPersistenceDeps, Error>> {
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
