import { Database, createKyselyDatabase, getDatabaseConfig } from '@crypto/data';
import type sqlite3Module from 'sqlite3';

import type { IRawDataRepository } from '../../app/ports/raw-data-repository.ts';

import { KyselyRawDataRepository } from './kysely-raw-data-repository.ts';
import { RawDataRepository } from './raw-data-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

/**
 * Factory function to create the appropriate raw data repository implementation
 * based on feature toggle configuration
 */
export function createRawDataRepository(sqliteDb?: SQLiteDatabase, dbPath?: string): IRawDataRepository {
  const config = getDatabaseConfig();

  if (config.useKysely) {
    // Use Kysely implementation
    const kyselyDb = createKyselyDatabase(dbPath || config.dbPath);
    return new KyselyRawDataRepository(kyselyDb);
  } else {
    // Use existing SQLite3 implementation
    if (!sqliteDb) {
      // Fallback: create database instance if not provided
      const database = new Database(dbPath || config.dbPath);
      // Get the underlying SQLite database instance (note: this is a simplification)
      // In practice, you might need to expose the db property or refactor Database class
      sqliteDb = (database as unknown as { db: SQLiteDatabase }).db;
    }
    return new RawDataRepository(sqliteDb);
  }
}

/**
 * Type guard to check if repository is using Kysely implementation
 */
export function isKyselyRawDataRepository(repository: IRawDataRepository): repository is KyselyRawDataRepository {
  return repository instanceof KyselyRawDataRepository;
}

/**
 * Type guard to check if repository is using SQLite3 implementation
 */
export function isSqliteRawDataRepository(repository: IRawDataRepository): repository is RawDataRepository {
  return repository instanceof RawDataRepository;
}
