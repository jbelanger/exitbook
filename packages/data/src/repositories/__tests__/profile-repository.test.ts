import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { ProfileRepository } from '../profile-repository.js';

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
      const profile = assertOk(await repo.create({ name: 'Joel', profileKey: 'joel-main' }));

      expect(profile.id).toBeGreaterThan(0);
      expect(profile.profileKey).toBe('joel-main');
      expect(profile.name).toBe('joel');

      const row = await db.selectFrom('profiles').selectAll().where('id', '=', profile.id).executeTakeFirst();
      expect(row).toBeDefined();
      expect(row?.id).toBe(profile.id);
      expect(row?.profile_key).toBe('joel-main');
      expect(row?.name).toBe('joel');
      expect(row?.created_at).toBeDefined();
    });

    it('creates multiple profiles with distinct IDs', async () => {
      const profile1 = assertOk(await repo.create({ name: 'joel', profileKey: 'joel' }));
      const profile2 = assertOk(await repo.create({ name: 'son', profileKey: 'son' }));

      expect(profile1.id).not.toBe(profile2.id);
    });

    it('normalizes names and rejects duplicates case-insensitively', async () => {
      assertOk(await repo.create({ name: 'Joel', profileKey: 'joel' }));

      const result = await repo.create({ name: 'joel', profileKey: 'joel-2' });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }

      expect(result.error.message).toBe("Profile 'joel' already exists");
    });

    it('rejects duplicate profile keys', async () => {
      assertOk(await repo.create({ name: 'Joel', profileKey: 'shared-key' }));

      const result = await repo.create({ name: 'Son', profileKey: 'shared-key' });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }

      expect(result.error.message).toBe("Profile key 'shared-key' already exists");
    });

    it('rejects empty names', async () => {
      const result = await repo.create({ name: '   ', profileKey: 'empty-name' });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }

      expect(result.error.message).toBe('Profile name must not be empty');
    });
  });

  describe('findById', () => {
    it('returns an existing profile', async () => {
      const profile = assertOk(await repo.create({ name: 'joel', profileKey: 'joel-key' }));
      const loaded = assertOk(await repo.findById(profile.id));

      expect(loaded?.id).toBe(profile.id);
      expect(loaded?.profileKey).toBe('joel-key');
      expect(loaded?.name).toBe('joel');
      expect(loaded?.createdAt).toBeInstanceOf(Date);
    });

    it('returns undefined for a non-existent profile', async () => {
      const profile = assertOk(await repo.findById(999));

      expect(profile).toBeUndefined();
    });
  });

  describe('findByName', () => {
    it('finds an existing profile by normalized name', async () => {
      const profile = assertOk(await repo.create({ name: 'Joel', profileKey: 'joel-key' }));
      const loaded = assertOk(await repo.findByName(' joel '));

      expect(loaded).toEqual(profile);
    });

    it('returns undefined for a missing profile name', async () => {
      const loaded = assertOk(await repo.findByName('missing'));

      expect(loaded).toBeUndefined();
    });
  });

  describe('list', () => {
    it('lists profiles ordered by name', async () => {
      assertOk(await repo.create({ name: 'son', profileKey: 'son' }));
      assertOk(await repo.create({ name: 'joel', profileKey: 'joel' }));

      const profiles = assertOk(await repo.list());

      expect(profiles.map((profile) => profile.name)).toEqual(['joel', 'son']);
    });
  });

  describe('findOrCreateDefault', () => {
    it('creates default profile when it does not exist', async () => {
      const profile = assertOk(await repo.findOrCreateDefault());

      expect(profile.id).toBe(1);
      expect(profile.profileKey).toBe('default');
      expect(profile.name).toBe('default');
      expect(profile.createdAt).toBeInstanceOf(Date);

      const row = await db.selectFrom('profiles').selectAll().where('id', '=', 1).executeTakeFirst();
      expect(row?.id).toBe(1);
      expect(row?.profile_key).toBe('default');
      expect(row?.name).toBe('default');
    });

    it('returns the existing default profile without creating a duplicate', async () => {
      const first = assertOk(await repo.findOrCreateDefault());
      const second = assertOk(await repo.findOrCreateDefault());

      expect(second.id).toBe(1);
      expect(second.name).toBe('default');
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
      expect(result1.name).toBe('default');
      expect(result2.id).toBe(1);
      expect(result3.id).toBe(1);

      const profiles = await db.selectFrom('profiles').selectAll().execute();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]?.id).toBe(1);
    });
  });
});
