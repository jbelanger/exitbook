import { DEFAULT_PROFILE_NAME, type Profile } from '@exitbook/core';
import { ProfileSchema } from '@exitbook/core';
import { wrapError } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { sql } from '@exitbook/sqlite';
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
    name: row.name,
    createdAt: new Date(row.created_at),
  });

  if (!parseResult.success) {
    throw new Error(`Invalid profile data: ${parseResult.error.message}`);
  }

  return parseResult.data;
}

function normalizeProfileName(name: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Profile name must not be empty'));
  }

  return ok(normalized);
}

export class ProfileRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'profile-repository');
  }

  async create(name: string): Promise<Result<Profile, Error>> {
    try {
      const normalizedNameResult = normalizeProfileName(name);
      if (normalizedNameResult.isErr()) {
        return err(normalizedNameResult.error);
      }
      const normalizedName = normalizedNameResult.value;

      const existingResult = await this.findByName(normalizedName);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }
      if (existingResult.value) {
        return err(new Error(`Profile '${normalizedName}' already exists`));
      }

      const result = await this.db
        .insertInto('profiles')
        .values({
          name: normalizedName,
          created_at: currentTimestamp(),
        })
        .returning(['id', 'name', 'created_at'])
        .executeTakeFirstOrThrow();

      return ok(toProfile(result));
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

  async findByName(name: string): Promise<Result<Profile | undefined, Error>> {
    try {
      const normalizedNameResult = normalizeProfileName(name);
      if (normalizedNameResult.isErr()) {
        return err(normalizedNameResult.error);
      }

      const row = await this.db
        .selectFrom('profiles')
        .selectAll()
        .where(sql`lower(name)`, '=', normalizedNameResult.value)
        .executeTakeFirst();
      if (!row) {
        return ok(undefined);
      }

      return ok(toProfile(row));
    } catch (error) {
      return wrapError(error, 'Failed to find profile by name');
    }
  }

  async list(): Promise<Result<Profile[], Error>> {
    try {
      const rows = await this.db.selectFrom('profiles').selectAll().orderBy('name asc').execute();
      return ok(rows.map((row) => toProfile(row)));
    } catch (error) {
      return wrapError(error, 'Failed to list profiles');
    }
  }

  async findOrCreateDefault(): Promise<Result<Profile, Error>> {
    try {
      const existingResult = await this.findByName(DEFAULT_PROFILE_NAME);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      if (existingResult.value) {
        return ok(existingResult.value);
      }

      const firstProfile = await this.db.selectFrom('profiles').select('id').limit(1).executeTakeFirst();

      const result = await this.db
        .insertInto('profiles')
        .values({
          ...(firstProfile ? {} : { id: 1 }),
          name: DEFAULT_PROFILE_NAME,
          created_at: currentTimestamp(),
        })
        .returning(['id', 'name', 'created_at'])
        .executeTakeFirstOrThrow();

      const profile = toProfile(result);
      this.logger.info({ profileId: profile.id }, 'Created default CLI profile');
      return ok(profile);
    } catch (error) {
      return wrapError(error, 'Failed to ensure default profile');
    }
  }
}
