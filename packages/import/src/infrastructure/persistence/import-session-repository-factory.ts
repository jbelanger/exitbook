import { Database, createKyselyDatabase, getDatabaseConfig } from '@crypto/data';
import type sqlite3Module from 'sqlite3';

import type { IImportSessionRepository } from '../../app/ports/import-session-repository.ts';

import { ImportSessionRepository } from './import-session-repository.ts';
import { KyselyImportSessionRepository } from './kysely-import-session-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

/**
 * Factory function to create the appropriate import session repository implementation
 * based on feature toggle configuration
 */
export function createImportSessionRepository(sqliteDb?: SQLiteDatabase, dbPath?: string): IImportSessionRepository {
  const config = getDatabaseConfig();

  if (config.useKysely) {
    // Use Kysely implementation
    const kyselyDb = createKyselyDatabase(dbPath || config.dbPath);
    return new KyselyImportSessionRepository(kyselyDb);
  } else {
    // Use existing SQLite3 implementation
    if (!sqliteDb) {
      // Fallback: create database instance if not provided
      const database = new Database(dbPath || config.dbPath);
      // Get the underlying SQLite database instance (note: this is a simplification)
      // In practice, you might need to expose the db property or refactor Database class
      sqliteDb = (database as unknown as { db: SQLiteDatabase }).db;
    }
    return new ImportSessionRepository(sqliteDb);
  }
}

/**
 * Type guard to check if repository is using Kysely implementation
 */
export function isKyselyImportSessionRepository(
  repository: IImportSessionRepository
): repository is KyselyImportSessionRepository {
  return repository instanceof KyselyImportSessionRepository;
}

/**
 * Type guard to check if repository is using SQLite3 implementation
 */
export function isSqliteImportSessionRepository(
  repository: IImportSessionRepository
): repository is ImportSessionRepository {
  return repository instanceof ImportSessionRepository;
}
