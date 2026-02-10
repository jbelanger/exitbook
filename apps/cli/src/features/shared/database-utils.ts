import path from 'node:path';

// eslint-disable-next-line no-restricted-imports -- centralized database utils for CLI features
import type { KyselyDB } from '@exitbook/data';
import { closeDatabase, initializeDatabase } from '@exitbook/data';

import { getDataDir } from './data-dir.js';

/**
 * Execute a function with an initialized database connection, ensuring cleanup in finally block.
 *
 * Opens transactions.db in the data directory, executes the function with the database instance,
 * and guarantees closeDatabase is called even if the function throws.
 *
 * @param fn - Function to execute with the database instance
 * @returns The return value of the function
 *
 * @example
 * await withDatabase(async (database) => {
 *   const accountRepo = new AccountRepository(database);
 *   return await accountRepo.findAll();
 * });
 */
export async function withDatabase<T>(fn: (database: KyselyDB) => Promise<T>): Promise<T> {
  const dataDir = getDataDir();
  const database = await initializeDatabase(path.join(dataDir, 'transactions.db'));
  try {
    return await fn(database);
  } finally {
    await closeDatabase(database);
  }
}
