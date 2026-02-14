import path from 'node:path';

import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { TokenMetadataRepository } from '../../repositories/token-metadata-repository.js';

import {
  closeTokenMetadataDatabase,
  createTokenMetadataDatabase,
  initializeTokenMetadataDatabase,
  type TokenMetadataDB,
} from './database.js';

const logger = getLogger('TokenMetadataRepositoryFactory');

export interface TokenMetadataPersistenceDeps {
  repository: TokenMetadataRepository;
  database: TokenMetadataDB;
  cleanup: () => Promise<void>;
}

/**
 * Create token metadata persistence dependencies backed by token-metadata.db.
 */
export async function createTokenMetadataPersistence(
  dataDir: string
): Promise<Result<TokenMetadataPersistenceDeps, Error>> {
  const dbPath = path.join(dataDir, 'token-metadata.db');
  const dbResult = createTokenMetadataDatabase(dbPath);

  if (dbResult.isErr()) {
    return err(dbResult.error);
  }

  const database = dbResult.value;
  const migrationResult = await initializeTokenMetadataDatabase(database);

  if (migrationResult.isErr()) {
    logger.error({ error: migrationResult.error }, 'Failed to initialize token metadata database');

    const closeResult = await closeTokenMetadataDatabase(database);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close token metadata database after initialization failure');
    }

    return err(migrationResult.error);
  }

  const repository = new TokenMetadataRepository(database);

  const cleanup = async () => {
    const closeResult = await closeTokenMetadataDatabase(database);
    if (closeResult.isErr()) {
      throw closeResult.error;
    }
  };

  return ok({
    repository,
    database,
    cleanup,
  });
}
