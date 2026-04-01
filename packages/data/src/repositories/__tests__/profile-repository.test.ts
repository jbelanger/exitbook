/* eslint-disable unicorn/no-null -- db nulls required for repository fixtures */

import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { ProfileRepository } from '../profile-repository.js';

import { computeTestAccountFingerprint } from './helpers.js';

describe('ProfileRepository', () => {
  let db: KyselyDB;
  let repo: ProfileRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new ProfileRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('create', () => {
    it('creates a profile and returns it', async () => {
      const profile = assertOk(await repo.create({ displayName: 'Joel Main', profileKey: 'joel-main' }));

      expect(profile.id).toBeGreaterThan(0);
      expect(profile.profileKey).toBe('joel-main');
      expect(profile.displayName).toBe('Joel Main');

      const row = await db.selectFrom('profiles').selectAll().where('id', '=', profile.id).executeTakeFirst();
      expect(row).toBeDefined();
      expect(row?.id).toBe(profile.id);
      expect(row?.profile_key).toBe('joel-main');
      expect(row?.display_name).toBe('Joel Main');
      expect(row?.created_at).toBeDefined();
    });

    it('creates multiple profiles with distinct IDs', async () => {
      const profile1 = assertOk(await repo.create({ displayName: 'joel', profileKey: 'joel' }));
      const profile2 = assertOk(await repo.create({ displayName: 'son', profileKey: 'son' }));

      expect(profile1.id).not.toBe(profile2.id);
    });

    it('rejects duplicate profile keys', async () => {
      assertOk(await repo.create({ displayName: 'Joel', profileKey: 'shared-key' }));

      const result = await repo.create({ displayName: 'Son', profileKey: 'shared-key' });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }

      expect(result.error.message).toBe("Profile key 'shared-key' already exists");
    });

    it('rejects empty display names', async () => {
      const result = await repo.create({ displayName: '   ', profileKey: 'empty-name' });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }

      expect(result.error.message).toBe('Profile display name must not be empty');
    });
  });

  describe('findById', () => {
    it('returns an existing profile', async () => {
      const profile = assertOk(await repo.create({ displayName: 'Joel', profileKey: 'joel-key' }));
      const loaded = assertOk(await repo.findById(profile.id));

      expect(loaded?.id).toBe(profile.id);
      expect(loaded?.profileKey).toBe('joel-key');
      expect(loaded?.displayName).toBe('Joel');
      expect(loaded?.createdAt).toBeInstanceOf(Date);
    });

    it('returns undefined for a non-existent profile', async () => {
      const profile = assertOk(await repo.findById(999));

      expect(profile).toBeUndefined();
    });
  });

  describe('findByKey', () => {
    it('finds an existing profile by normalized key', async () => {
      const profile = assertOk(await repo.create({ displayName: 'Joel', profileKey: 'joel-key' }));
      const loaded = assertOk(await repo.findByKey(' Joel_Key '));

      expect(loaded).toEqual(profile);
    });

    it('returns undefined for a missing profile key', async () => {
      const loaded = assertOk(await repo.findByKey('missing'));

      expect(loaded).toBeUndefined();
    });
  });

  describe('list', () => {
    it('lists profiles ordered by display name', async () => {
      assertOk(await repo.create({ displayName: 'Son', profileKey: 'son' }));
      assertOk(await repo.create({ displayName: 'Joel', profileKey: 'joel' }));

      const profiles = assertOk(await repo.list());

      expect(profiles.map((profile) => profile.displayName)).toEqual(['Joel', 'Son']);
    });

    it('returns an error when a persisted profile row is invalid', async () => {
      await db
        .insertInto('profiles')
        .values({
          profile_key: 'broken',
          display_name: '',
          created_at: new Date().toISOString(),
        })
        .execute();

      const result = await repo.list();

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }

      expect(result.error.message).toContain('Failed to list profiles: Invalid profile data:');
    });
  });

  describe('listSummaries', () => {
    it('lists profiles with top-level named account counts', async () => {
      const defaultProfile = assertOk(await repo.create({ displayName: 'default', profileKey: 'default' }));
      const businessProfile = assertOk(await repo.create({ displayName: 'Business', profileKey: 'business' }));

      await db
        .insertInto('accounts')
        .values([
          {
            id: 101,
            profile_id: defaultProfile.id,
            name: 'wallet-main',
            parent_account_id: null,
            account_type: 'blockchain',
            platform_key: 'bitcoin',
            identifier: 'bc1q-parent',
            account_fingerprint: await computeTestAccountFingerprint(db, {
              profileId: defaultProfile.id,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'bc1q-parent',
            }),
            provider_name: null,
            credentials: null,
            last_cursor: null,
            metadata: null,
            created_at: new Date().toISOString(),
            updated_at: null,
          },
          {
            id: 102,
            profile_id: defaultProfile.id,
            name: null,
            parent_account_id: null,
            account_type: 'exchange-api',
            platform_key: 'kraken',
            identifier: 'api-key-default',
            account_fingerprint: await computeTestAccountFingerprint(db, {
              profileId: defaultProfile.id,
              accountType: 'exchange-api',
              platformKey: 'kraken',
              identifier: 'api-key-default',
            }),
            provider_name: null,
            credentials: null,
            last_cursor: null,
            metadata: null,
            created_at: new Date().toISOString(),
            updated_at: null,
          },
          {
            id: 103,
            profile_id: defaultProfile.id,
            name: null,
            parent_account_id: 101,
            account_type: 'blockchain',
            platform_key: 'bitcoin',
            identifier: 'bc1q-child',
            account_fingerprint: await computeTestAccountFingerprint(db, {
              profileId: defaultProfile.id,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'bc1q-child',
            }),
            provider_name: null,
            credentials: null,
            last_cursor: null,
            metadata: null,
            created_at: new Date().toISOString(),
            updated_at: null,
          },
          {
            id: 201,
            profile_id: businessProfile.id,
            name: 'kraken-main',
            parent_account_id: null,
            account_type: 'exchange-api',
            platform_key: 'kraken',
            identifier: 'api-key-business',
            account_fingerprint: await computeTestAccountFingerprint(db, {
              profileId: businessProfile.id,
              accountType: 'exchange-api',
              platformKey: 'kraken',
              identifier: 'api-key-business',
            }),
            provider_name: null,
            credentials: null,
            last_cursor: null,
            metadata: null,
            created_at: new Date().toISOString(),
            updated_at: null,
          },
          {
            id: 202,
            profile_id: businessProfile.id,
            name: 'coinbase-csv',
            parent_account_id: null,
            account_type: 'exchange-csv',
            platform_key: 'coinbase',
            identifier: '/tmp/coinbase',
            account_fingerprint: await computeTestAccountFingerprint(db, {
              profileId: businessProfile.id,
              accountType: 'exchange-csv',
              platformKey: 'coinbase',
              identifier: '/tmp/coinbase',
            }),
            provider_name: null,
            credentials: null,
            last_cursor: null,
            metadata: null,
            created_at: new Date().toISOString(),
            updated_at: null,
          },
        ])
        .execute();

      const summaries = assertOk(await repo.listSummaries());

      expect(
        summaries.map((summary) => ({
          accountCount: summary.accountCount,
          displayName: summary.displayName,
          profileKey: summary.profileKey,
        }))
      ).toEqual([
        { displayName: 'Business', profileKey: 'business', accountCount: 2 },
        { displayName: 'default', profileKey: 'default', accountCount: 1 },
      ]);
    });
  });

  describe('updateDisplayName', () => {
    it('updates a profile display name without changing the key', async () => {
      assertOk(await repo.create({ displayName: 'son', profileKey: 'son' }));

      const updated = assertOk(await repo.updateDisplayName('son', 'Son / Family'));

      expect(updated.profileKey).toBe('son');
      expect(updated.displayName).toBe('Son / Family');
    });
  });

  describe('deleteByKey', () => {
    it('deletes an existing profile by key', async () => {
      const profile = assertOk(await repo.create({ displayName: 'son', profileKey: 'son' }));

      const deleted = assertOk(await repo.deleteByKey('son'));

      expect(deleted).toEqual(profile);
      expect(assertOk(await repo.findByKey('son'))).toBeUndefined();
    });

    it('returns a not-found error for a missing profile', async () => {
      const result = await repo.deleteByKey('missing');

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }

      expect(result.error.message).toBe("Profile 'missing' not found");
    });
  });

  describe('findOrCreateDefault', () => {
    it('creates default profile when it does not exist', async () => {
      const profile = assertOk(await repo.findOrCreateDefault());

      expect(profile.id).toBe(1);
      expect(profile.profileKey).toBe('default');
      expect(profile.displayName).toBe('default');
      expect(profile.createdAt).toBeInstanceOf(Date);

      const row = await db.selectFrom('profiles').selectAll().where('id', '=', 1).executeTakeFirst();
      expect(row?.id).toBe(1);
      expect(row?.profile_key).toBe('default');
      expect(row?.display_name).toBe('default');
    });

    it('returns the existing default profile without creating a duplicate', async () => {
      const first = assertOk(await repo.findOrCreateDefault());
      const second = assertOk(await repo.findOrCreateDefault());

      expect(second.id).toBe(1);
      expect(second.displayName).toBe('default');
      expect(second.createdAt).toEqual(first.createdAt);

      const profiles = await db.selectFrom('profiles').selectAll().execute();
      expect(profiles).toHaveLength(1);
    });

    it('is idempotent across multiple sequential calls', async () => {
      const result1 = assertOk(await repo.findOrCreateDefault());
      const result2 = assertOk(await repo.findOrCreateDefault());
      const result3 = assertOk(await repo.findOrCreateDefault());

      expect(result1.id).toBe(1);
      expect(result1.profileKey).toBe('default');
      expect(result1.displayName).toBe('default');
      expect(result2.id).toBe(1);
      expect(result3.id).toBe(1);

      const profiles = await db.selectFrom('profiles').selectAll().execute();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]?.id).toBe(1);
    });
  });
});
