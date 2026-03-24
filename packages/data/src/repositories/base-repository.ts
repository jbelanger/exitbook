import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';

import type { KyselyDB } from '../database.js';

/**
 * Naming convention for repository query methods:
 *
 * Current code still contains older repositories where `findById` means
 * "must exist" and newer repositories where it means "optional lookup". New
 * code should converge on the explicit split below instead of extending the
 * ambiguity:
 *
 *   getById(id)        → Result<T, Error>                Must exist; error if not found.
 *   findById(id)       → Result<T | undefined, Error>    Single record; undefined if absent.
 *   findBy(filters)    → Result<T | undefined, Error>    Single record; undefined if absent.
 *   findAll(filters?)  → Result<T[], Error>              Always returns a list (empty when none match).
 *
 * Mutation methods: create / update / delete / save (save = upsert).
 * Aggregate methods: count / exists.
 */
export abstract class BaseRepository {
  protected readonly logger: Logger;

  constructor(
    protected readonly db: KyselyDB,
    loggerName: string
  ) {
    this.logger = getLogger(loggerName);
  }
}
