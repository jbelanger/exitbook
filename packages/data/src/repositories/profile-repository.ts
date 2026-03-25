import type { Profile } from '@exitbook/core';
import { ProfileSchema } from '@exitbook/core';
import { wrapError } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Selectable } from '@exitbook/sqlite';

import type { ProfilesTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

function currentTimestamp(): string {
  return new Date().toISOString();
}

function toProfile(row: Selectable<ProfilesTable>): Profile {
  const parseResult = ProfileSchema.safeParse({
    id: row.id,
    createdAt: new Date(row.created_at),
  });

  if (!parseResult.success) {
    throw new Error(`Invalid profile data: ${parseResult.error.message}`);
  }

  return parseResult.data;
}

export class ProfileRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'profile-repository');
  }

  async create(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('profiles')
        .values({
          created_at: currentTimestamp(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to create profile');
    }
  }

  async findById(profileId: number): Promise<Result<Profile | undefined, Error>> {
    try {
      const row = await this.db.selectFrom('profiles').selectAll().where('id', '=', profileId).executeTakeFirst();
      if (!row) {
        return ok(undefined);
      }

      return ok(toProfile(row));
    } catch (error) {
      return wrapError(error, 'Failed to find profile by ID');
    }
  }

  async findOrCreateDefault(): Promise<Result<Profile, Error>> {
    try {
      const existingResult = await this.findById(1);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      if (existingResult.value) {
        return ok(existingResult.value);
      }

      const result = await this.db
        .insertInto('profiles')
        .values({
          id: 1,
          created_at: currentTimestamp(),
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();

      const profile = toProfile(result);
      this.logger.info('Created default CLI profile (id=1)');
      return ok(profile);
    } catch (error) {
      return wrapError(error, 'Failed to ensure default profile');
    }
  }
}
