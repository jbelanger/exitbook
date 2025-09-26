import { createKyselyDatabase } from '@crypto/data';

import type { IWalletRepository } from '../../app/ports/wallet-repository.ts';

import { KyselyWalletRepository } from './kysely-wallet-repository.ts';

/**
 * Factory function to create wallet repository implementation using Kysely
 */
export function createWalletRepository(dbPath?: string): IWalletRepository {
  const kyselyDb = createKyselyDatabase(dbPath);
  return new KyselyWalletRepository(kyselyDb);
}
