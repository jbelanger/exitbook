import { createKyselyDatabase } from '@crypto/data';

import type { ITransactionRepository } from '../../app/ports/transaction-repository.ts';

import { KyselyTransactionRepository } from './kysely-transaction-repository.ts';

/**
 * Factory function to create transaction repository implementation using Kysely
 */
export function createTransactionRepository(dbPath?: string): ITransactionRepository {
  const kyselyDb = createKyselyDatabase(dbPath);
  return new KyselyTransactionRepository(kyselyDb);
}
