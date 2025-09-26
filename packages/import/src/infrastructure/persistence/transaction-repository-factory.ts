import { Database, createKyselyDatabase, getDatabaseConfig } from '@crypto/data';
import type sqlite3Module from 'sqlite3';

import type { ITransactionRepository } from '../../app/ports/transaction-repository.ts';

import { KyselyTransactionRepository } from './kysely-transaction-repository.ts';
import { TransactionRepository } from './transaction-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

/**
 * Factory function to create the appropriate transaction repository implementation
 * based on feature toggle configuration
 */
export function createTransactionRepository(sqliteDb?: SQLiteDatabase, dbPath?: string): ITransactionRepository {
  const config = getDatabaseConfig();

  if (config.useKysely) {
    // Use Kysely implementation
    const kyselyDb = createKyselyDatabase(dbPath || config.dbPath);
    return new KyselyTransactionRepository(kyselyDb);
  } else {
    // Use existing SQLite3 implementation
    if (!sqliteDb) {
      // Fallback: create database instance if not provided
      const database = new Database(dbPath || config.dbPath);
      // Get the underlying SQLite database instance (note: this is a simplification)
      // In practice, you might need to expose the db property or refactor Database class
      sqliteDb = (database as unknown as { db: SQLiteDatabase }).db;
    }
    return new TransactionRepository(sqliteDb);
  }
}

/**
 * Type guard to check if repository is using Kysely implementation
 */
export function isKyselyTransactionRepository(
  repository: ITransactionRepository
): repository is KyselyTransactionRepository {
  return repository instanceof KyselyTransactionRepository;
}

/**
 * Type guard to check if repository is using SQLite3 implementation
 */
export function isSqliteTransactionRepository(repository: ITransactionRepository): repository is TransactionRepository {
  return repository instanceof TransactionRepository;
}
