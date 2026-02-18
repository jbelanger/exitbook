import type { User } from '@exitbook/core';
import { UserSchema, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Selectable } from 'kysely';
import { err, ok } from 'neverthrow';

import type { UsersTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/database.js';

export function createUserQueries(db: KyselyDB) {
  const logger = getLogger('user-queries');

  function toUser(row: Selectable<UsersTable>): User {
    const parseResult = UserSchema.safeParse({
      id: row.id,
      createdAt: new Date(row.created_at),
    });

    if (!parseResult.success) {
      throw new Error(`Invalid user data: ${parseResult.error.message}`);
    }

    return parseResult.data;
  }

  async function create() {
    try {
      const result = await db
        .insertInto('users')
        .values({
          created_at: new Date().toISOString(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to create user');
    }
  }

  async function findById(userId: number) {
    try {
      const row = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();
      if (!row) {
        return ok(undefined);
      }

      return ok(toUser(row));
    } catch (error) {
      return wrapError(error, 'Failed to find user by ID');
    }
  }

  async function ensureDefaultUser() {
    try {
      const existingResult = await findById(1);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      if (existingResult.value) {
        return ok(existingResult.value);
      }

      const result = await db
        .insertInto('users')
        .values({
          id: 1,
          created_at: new Date().toISOString(),
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();

      const user = toUser(result);
      logger.info('Created default CLI user (id=1)');
      return ok(user);
    } catch (error) {
      return wrapError(error, 'Failed to ensure default user');
    }
  }

  return {
    create,
    findById,
    ensureDefaultUser,
  };
}

export type UserQueries = ReturnType<typeof createUserQueries>;
