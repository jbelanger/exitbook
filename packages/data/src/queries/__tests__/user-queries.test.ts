import { createTestDatabase, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUserQueries, type UserQueries } from '../user-queries.js';

describe('UserQueries', () => {
  let db: KyselyDB;
  let queries: UserQueries;

  beforeEach(async () => {
    db = await createTestDatabase();
    queries = createUserQueries(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('create', () => {
    it('should create a new user and return its ID', async () => {
      const result = await queries.create();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeGreaterThan(0);

        // Verify user was created in database
        const user = await db.selectFrom('users').selectAll().where('id', '=', result.value).executeTakeFirst();
        expect(user).toBeDefined();
        expect(user?.id).toBe(result.value);
        expect(user?.created_at).toBeDefined();
      }
    });

    it('should create multiple users with different IDs', async () => {
      const result1 = await queries.create();
      const result2 = await queries.create();

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      if (result1.isOk() && result2.isOk()) {
        expect(result1.value).not.toBe(result2.value);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.create();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findById', () => {
    it('should find an existing user by ID', async () => {
      const createResult = await queries.create();
      expect(createResult.isOk()).toBe(true);

      if (createResult.isOk()) {
        const userId = createResult.value;
        const result = await queries.findById(userId);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value).toBeDefined();
          expect(result.value?.id).toBe(userId);
          expect(result.value?.createdAt).toBeInstanceOf(Date);
        }
      }
    });

    it('should return undefined for non-existent user', async () => {
      const result = await queries.findById(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.findById(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getOrCreateDefaultUser', () => {
    it('should create default user (id=1) if not exists', async () => {
      const result = await queries.getOrCreateDefaultUser();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe(1);
        expect(result.value.createdAt).toBeInstanceOf(Date);
      }

      // Verify in database
      const user = await db.selectFrom('users').selectAll().where('id', '=', 1).executeTakeFirst();
      expect(user).toBeDefined();
      expect(user?.id).toBe(1);
    });

    it('should return existing default user if already exists', async () => {
      // Create default user first
      const firstResult = await queries.getOrCreateDefaultUser();
      expect(firstResult.isOk()).toBe(true);

      if (firstResult.isOk()) {
        const firstCreatedAt = firstResult.value.createdAt;

        // Call again - should return same user
        const secondResult = await queries.getOrCreateDefaultUser();
        expect(secondResult.isOk()).toBe(true);

        if (secondResult.isOk()) {
          expect(secondResult.value.id).toBe(1);
          expect(secondResult.value.createdAt).toEqual(firstCreatedAt);
        }
      }

      // Verify only one user exists
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(1);
    });

    it('should be idempotent and safe to call multiple times', async () => {
      // Call sequentially (concurrent calls may have race conditions)
      const result1 = await queries.getOrCreateDefaultUser();
      const result2 = await queries.getOrCreateDefaultUser();
      const result3 = await queries.getOrCreateDefaultUser();

      // All should succeed
      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result3.isOk()).toBe(true);

      // All should return user with id=1
      if (result1.isOk() && result2.isOk() && result3.isOk()) {
        expect(result1.value.id).toBe(1);
        expect(result2.value.id).toBe(1);
        expect(result3.value.id).toBe(1);
      }

      // Only one user should exist in database
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(1);
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.getOrCreateDefaultUser();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
