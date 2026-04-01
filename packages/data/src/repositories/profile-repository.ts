/* eslint-disable unicorn/no-null -- db null handling required */

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

function toProfile(row: Selectable<ProfilesTable>): Result<Profile, Error> {
  const parseResult = ProfileSchema.safeParse({
    id: row.id,
    profileKey: row.profile_key,
    displayName: row.display_name,
    createdAt: new Date(row.created_at),
  });

  if (!parseResult.success) {
    return err(new Error(`Invalid profile data: ${parseResult.error.message}`));
  }

  return ok(parseResult.data);
}

function toProfileSummary(row: Selectable<ProfilesTable> & { account_count: number }): Result<ProfileSummary, Error> {
  const profileResult = toProfile(row);
  if (profileResult.isErr()) {
    return err(profileResult.error);
  }

  return ok({
    ...profileResult.value,
    accountCount: Number(row.account_count),
  });
}

type ProfileSummary = Profile & { accountCount: number };

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

      const profileResult = toProfile(result);
      if (profileResult.isErr()) {
        return wrapError(profileResult.error, 'Failed to create profile');
      }

      return ok(profileResult.value);
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

      const profileResult = toProfile(row);
      if (profileResult.isErr()) {
        return wrapError(profileResult.error, 'Failed to find profile by ID');
      }

      return ok(profileResult.value);
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

      const profileResult = toProfile(row);
      if (profileResult.isErr()) {
        return wrapError(profileResult.error, 'Failed to find profile by key');
      }

      return ok(profileResult.value);
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
      const profiles: Profile[] = [];
      for (const row of rows) {
        const profileResult = toProfile(row);
        if (profileResult.isErr()) {
          return wrapError(profileResult.error, 'Failed to list profiles');
        }
        profiles.push(profileResult.value);
      }

      return ok(profiles);
    } catch (error) {
      return wrapError(error, 'Failed to list profiles');
    }
  }

  async listSummaries(): Promise<Result<ProfileSummary[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('profiles')
        .leftJoin('accounts', (join) =>
          join
            .onRef('accounts.profile_id', '=', 'profiles.id')
            .on('accounts.parent_account_id', 'is', null)
            .on('accounts.name', 'is not', null)
        )
        .select([
          'profiles.id',
          'profiles.profile_key',
          'profiles.display_name',
          'profiles.created_at',
          sql<number>`count(accounts.id)`.as('account_count'),
        ])
        .groupBy(['profiles.id', 'profiles.profile_key', 'profiles.display_name', 'profiles.created_at'])
        .orderBy(sql`lower(profiles.display_name)`)
        .orderBy('profiles.profile_key', 'asc')
        .execute();

      const summaries: ProfileSummary[] = [];
      for (const row of rows) {
        const summaryResult = toProfileSummary(row);
        if (summaryResult.isErr()) {
          return wrapError(summaryResult.error, 'Failed to list profile summaries');
        }
        summaries.push(summaryResult.value);
      }

      return ok(summaries);
    } catch (error) {
      return wrapError(error, 'Failed to list profile summaries');
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

      const profileResult = toProfile(result);
      if (profileResult.isErr()) {
        return wrapError(profileResult.error, 'Failed to update profile display name');
      }

      return ok(profileResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to update profile display name');
    }
  }

  async deleteByKey(profileKey: string): Promise<Result<Profile, Error>> {
    try {
      const normalizedKeyResult = normalizeProfileKey(profileKey);
      if (normalizedKeyResult.isErr()) {
        return err(normalizedKeyResult.error);
      }

      const existingResult = await this.findByKey(normalizedKeyResult.value);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }
      if (!existingResult.value) {
        return err(new Error(`Profile '${normalizedKeyResult.value}' not found`));
      }

      await this.db.deleteFrom('profiles').where('profile_key', '=', normalizedKeyResult.value).executeTakeFirst();

      return ok(existingResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to delete profile');
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

      const profileResult = toProfile(result);
      if (profileResult.isErr()) {
        return wrapError(profileResult.error, 'Failed to ensure default profile');
      }

      const profile = profileResult.value;
      this.logger.info({ profileId: profile.id }, 'Created default CLI profile');
      return ok(profile);
    } catch (error) {
      return wrapError(error, 'Failed to ensure default profile');
    }
  }
}
