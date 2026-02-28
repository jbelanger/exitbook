import { createTestDatabase } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../storage/initialization.js';
import { UserRepository } from '../user-repository.js';

describe('UserRepository', () => {
  let db: KyselyDB;
  let repo: UserRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new UserRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('create', () => {
    it('creates a user and returns its ID', async () => {
      const result = await repo.create();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeGreaterThan(0);

        const user = await db.selectFrom('users').selectAll().where('id', '=', result.value).executeTakeFirst();
        expect(user).toBeDefined();
        expect(user?.id).toBe(result.value);
        expect(user?.created_at).toBeDefined();
      }
    });

    it('creates multiple users with distinct IDs', async () => {
      const result1 = await repo.create();
      const result2 = await repo.create();

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      if (result1.isOk() && result2.isOk()) {
        expect(result1.value).not.toBe(result2.value);
      }
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
      const createResult = await repo.create();
      expect(createResult.isOk()).toBe(true);

      if (createResult.isOk()) {
        const result = await repo.findById(createResult.value);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value?.id).toBe(createResult.value);
          expect(result.value?.createdAt).toBeInstanceOf(Date);
        }
      }
    });

    it('returns undefined for a non-existent user', async () => {
      const result = await repo.findById(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
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

  describe('getOrCreateDefaultUser', () => {
    it('creates default user (id=1) when it does not exist', async () => {
      const result = await repo.getOrCreateDefaultUser();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe(1);
        expect(result.value.createdAt).toBeInstanceOf(Date);
      }

      const row = await db.selectFrom('users').selectAll().where('id', '=', 1).executeTakeFirst();
      expect(row?.id).toBe(1);
    });

    it('returns the existing default user without creating a duplicate', async () => {
      const first = await repo.getOrCreateDefaultUser();
      expect(first.isOk()).toBe(true);

      if (first.isOk()) {
        const second = await repo.getOrCreateDefaultUser();
        expect(second.isOk()).toBe(true);

        if (second.isOk()) {
          expect(second.value.id).toBe(1);
          expect(second.value.createdAt).toEqual(first.value.createdAt);
        }
      }

      const users = await db.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(1);
    });

    it('is idempotent across multiple sequential calls', async () => {
      // Sequential — concurrent calls can race on INSERT (SQLite has no upsert here)
      const result1 = await repo.getOrCreateDefaultUser();
      const result2 = await repo.getOrCreateDefaultUser();
      const result3 = await repo.getOrCreateDefaultUser();

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result3.isOk()).toBe(true);

      if (result1.isOk() && result2.isOk() && result3.isOk()) {
        expect(result1.value.id).toBe(1);
        expect(result2.value.id).toBe(1);
        expect(result3.value.id).toBe(1);
      }

      const users = await db.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(1);
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.getOrCreateDefaultUser();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
