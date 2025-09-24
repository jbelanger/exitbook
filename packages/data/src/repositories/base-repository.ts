// in @crypto/data/src/repositories/base-repository.ts
import { type Logger, getLogger } from '@crypto/shared-logger';

import type { Database } from '../storage/database.ts';

export abstract class BaseRepository {
  protected database: Database;
  protected logger: Logger;

  constructor(database: Database, repositoryName: string) {
    this.database = database;
    this.logger = getLogger(repositoryName);
  }
}
