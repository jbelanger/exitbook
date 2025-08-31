// in @crypto/data/src/repositories/base-repository.ts
import { getLogger, type Logger } from '@crypto/shared-logger';
import { Database } from '../storage/database.ts';

export abstract class BaseRepository {
  protected database: Database;
  protected logger: Logger;

  constructor(database: Database, repositoryName: string) {
    this.database = database;
    this.logger = getLogger(repositoryName);
  }
}