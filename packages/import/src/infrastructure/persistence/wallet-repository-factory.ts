import { Database, createKyselyDatabase, getDatabaseConfig } from '@crypto/data';
import type sqlite3Module from 'sqlite3';

import type { IWalletRepository } from '../../app/ports/wallet-repository.ts';

import { KyselyWalletRepository } from './kysely-wallet-repository.ts';
import { WalletRepository } from './wallet-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

/**
 * Factory function to create the appropriate wallet repository implementation
 * based on feature toggle configuration
 */
export function createWalletRepository(sqliteDb?: SQLiteDatabase, dbPath?: string): IWalletRepository {
  const config = getDatabaseConfig();

  if (config.useKysely) {
    // Use Kysely implementation
    const kyselyDb = createKyselyDatabase(dbPath || config.dbPath);
    return new KyselyWalletRepository(kyselyDb);
  } else {
    // Use existing SQLite3 implementation
    if (!sqliteDb) {
      // Fallback: create database instance if not provided
      const database = new Database(dbPath || config.dbPath);
      // Get the underlying SQLite database instance (note: this is a simplification)
      // In practice, you might need to expose the db property or refactor Database class
      sqliteDb = (database as unknown as { db: SQLiteDatabase }).db;
    }
    return new WalletRepository(sqliteDb);
  }
}

/**
 * Type guard to check if repository is using Kysely implementation
 */
export function isKyselyWalletRepository(repository: IWalletRepository): repository is KyselyWalletRepository {
  return repository instanceof KyselyWalletRepository;
}

/**
 * Type guard to check if repository is using SQLite3 implementation
 */
export function isSqliteWalletRepository(repository: IWalletRepository): repository is WalletRepository {
  return repository instanceof WalletRepository;
}
