import { DEFAULT_PROFILE_KEY, normalizeProfileDisplayName, normalizeProfileKey, type Profile } from '@exitbook/core';
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
    profileKey: row.profile_key,
    displayName: row.display_name,
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

  async create(input: { displayName: string; profileKey: string }): Promise<Result<Profile, Error>> {
    try {
      const normalizedDisplayNameResult = normalizeProfileDisplayName(input.displayName);
      if (normalizedDisplayNameResult.isErr()) {
        return err(normalizedDisplayNameResult.error);
      }

      const normalizedKeyResult = normalizeProfileKey(input.profileKey);
      if (normalizedKeyResult.isErr()) {
        return err(normalizedKeyResult.error);
      }
      const normalizedKey = normalizedKeyResult.value;

      const existingResult = await this.findByKey(normalizedKey);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }
      if (existingResult.value) {
        return err(new Error(`Profile key '${normalizedKey}' already exists`));
      }

      const result = await this.db
        .insertInto('profiles')
        .values({
          display_name: normalizedDisplayNameResult.value,
          profile_key: normalizedKey,
          created_at: currentTimestamp(),
        })
        .returning(['id', 'profile_key', 'display_name', 'created_at'])
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

  async findByKey(profileKey: string): Promise<Result<Profile | undefined, Error>> {
    try {
      const normalizedKeyResult = normalizeProfileKey(profileKey);
      if (normalizedKeyResult.isErr()) {
        return err(normalizedKeyResult.error);
      }

      const row = await this.db
        .selectFrom('profiles')
        .selectAll()
        .where('profile_key', '=', normalizedKeyResult.value)
        .executeTakeFirst();
      if (!row) {
        return ok(undefined);
      }

      return ok(toProfile(row));
    } catch (error) {
      return wrapError(error, 'Failed to find profile by key');
    }
  }

  async list(): Promise<Result<Profile[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('profiles')
        .selectAll()
        .orderBy(sql`lower(display_name)`)
        .orderBy('profile_key', 'asc')
        .execute();
      return ok(rows.map((row) => toProfile(row)));
    } catch (error) {
      return wrapError(error, 'Failed to list profiles');
    }
  }

  async updateDisplayName(profileKey: string, displayName: string): Promise<Result<Profile, Error>> {
    try {
      const normalizedKeyResult = normalizeProfileKey(profileKey);
      if (normalizedKeyResult.isErr()) {
        return err(normalizedKeyResult.error);
      }

      const normalizedDisplayNameResult = normalizeProfileDisplayName(displayName);
      if (normalizedDisplayNameResult.isErr()) {
        return err(normalizedDisplayNameResult.error);
      }

      const result = await this.db
        .updateTable('profiles')
        .set({
          display_name: normalizedDisplayNameResult.value,
        })
        .where('profile_key', '=', normalizedKeyResult.value)
        .returning(['id', 'profile_key', 'display_name', 'created_at'])
        .executeTakeFirst();

      if (!result) {
        return err(new Error(`Profile '${normalizedKeyResult.value}' not found`));
      }

      return ok(toProfile(result));
    } catch (error) {
      return wrapError(error, 'Failed to update profile display name');
    }
  }

  async findOrCreateDefault(): Promise<Result<Profile, Error>> {
    try {
      const existingResult = await this.findByKey(DEFAULT_PROFILE_KEY);
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
          profile_key: DEFAULT_PROFILE_KEY,
          display_name: DEFAULT_PROFILE_KEY,
          created_at: currentTimestamp(),
        })
        .returning(['id', 'profile_key', 'display_name', 'created_at'])
        .executeTakeFirstOrThrow();

      const profile = toProfile(result);
      this.logger.info({ profileId: profile.id }, 'Created default CLI profile');
      return ok(profile);
    } catch (error) {
      return wrapError(error, 'Failed to ensure default profile');
    }
  }
}
