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
    it('creates a user and returns its ID', async () => {
      const id = assertOk(await repo.create());

      expect(id).toBeGreaterThan(0);

      const user = await db.selectFrom('profiles').selectAll().where('id', '=', id).executeTakeFirst();
      expect(user).toBeDefined();
      expect(user?.id).toBe(id);
      expect(user?.created_at).toBeDefined();
    });

    it('creates multiple profiles with distinct IDs', async () => {
      const id1 = assertOk(await repo.create());
      const id2 = assertOk(await repo.create());

      expect(id1).not.toBe(id2);
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.create();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findById', () => {
    it('returns an existing user', async () => {
      const id = assertOk(await repo.create());
      const user = assertOk(await repo.findById(id));

      expect(user?.id).toBe(id);
      expect(user?.createdAt).toBeInstanceOf(Date);
    });

    it('returns undefined for a non-existent user', async () => {
      const user = assertOk(await repo.findById(999));

      expect(user).toBeUndefined();
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.findById(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findOrCreateDefault', () => {
    it('creates default user (id=1) when it does not exist', async () => {
      const user = assertOk(await repo.findOrCreateDefault());

      expect(user.id).toBe(1);
      expect(user.createdAt).toBeInstanceOf(Date);

      const row = await db.selectFrom('profiles').selectAll().where('id', '=', 1).executeTakeFirst();
      expect(row?.id).toBe(1);
    });

    it('returns the existing default user without creating a duplicate', async () => {
      const first = assertOk(await repo.findOrCreateDefault());
      const second = assertOk(await repo.findOrCreateDefault());

      expect(second.id).toBe(1);
      expect(second.createdAt).toEqual(first.createdAt);

      const profiles = await db.selectFrom('profiles').selectAll().execute();
      expect(profiles).toHaveLength(1);
    });

    it('is idempotent across multiple sequential calls', async () => {
      // Sequential — concurrent calls can race on INSERT (SQLite has no upsert here)
      const result1 = assertOk(await repo.findOrCreateDefault());
      const result2 = assertOk(await repo.findOrCreateDefault());
      const result3 = assertOk(await repo.findOrCreateDefault());

      expect(result1.id).toBe(1);
      expect(result2.id).toBe(1);
      expect(result3.id).toBe(1);

      const profiles = await db.selectFrom('profiles').selectAll().execute();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]?.id).toBe(1);
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.findOrCreateDefault();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
