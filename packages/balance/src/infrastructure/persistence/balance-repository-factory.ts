import { createKyselyDatabase } from '@crypto/data';

import { KyselyBalanceRepository } from './kysely-balance-repository.ts';

/**
 * Factory function to create balance repository implementation using Kysely
 */
export function createBalanceRepository(dbPath?: string): KyselyBalanceRepository {
  const kyselyDb = createKyselyDatabase(dbPath);
  return new KyselyBalanceRepository(kyselyDb);
}
