import { createKyselyDatabase } from '@crypto/data';

import type { IRawDataRepository } from '../../app/ports/raw-data-repository.ts';

import { KyselyRawDataRepository } from './kysely-raw-data-repository.ts';

/**
 * Factory function to create raw data repository implementation using Kysely
 */
export function createRawDataRepository(dbPath?: string): IRawDataRepository {
  const kyselyDb = createKyselyDatabase(dbPath);
  return new KyselyRawDataRepository(kyselyDb);
}
