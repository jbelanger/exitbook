import { createKyselyDatabase } from '@crypto/data';

import type { IImportSessionRepository } from '../../app/ports/import-session-repository.ts';

import { KyselyImportSessionRepository } from './kysely-import-session-repository.ts';

/**
 * Factory function to create import session repository implementation using Kysely
 */
export function createImportSessionRepository(dbPath?: string): IImportSessionRepository {
  const kyselyDb = createKyselyDatabase(dbPath);
  return new KyselyImportSessionRepository(kyselyDb);
}
