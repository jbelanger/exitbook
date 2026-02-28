import type { User } from '@exitbook/core';
import { UserSchema, wrapError } from '@exitbook/core';
import type { Selectable } from '@exitbook/sqlite';
import { err, ok, type Result } from 'neverthrow';

import type { UsersTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/initialization.js';

import { BaseRepository } from './base-repository.js';

function currentTimestamp(): string {
  return new Date().toISOString();
}

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

export class UserRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'user-repository');
  }

  async create(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('users')
        .values({
          created_at: currentTimestamp(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to create user');
    }
  }

  async findById(userId: number): Promise<Result<User | undefined, Error>> {
    try {
      const row = await this.db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();
      if (!row) {
        return ok(undefined);
      }

      return ok(toUser(row));
    } catch (error) {
      return wrapError(error, 'Failed to find user by ID');
    }
  }

  async findOrCreateDefault(): Promise<Result<User, Error>> {
    try {
      const existingResult = await this.findById(1);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      if (existingResult.value) {
        return ok(existingResult.value);
      }

      const result = await this.db
        .insertInto('users')
        .values({
          id: 1,
          created_at: currentTimestamp(),
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();

      const user = toUser(result);
      this.logger.info('Created default CLI user (id=1)');
      return ok(user);
    } catch (error) {
      return wrapError(error, 'Failed to ensure default user');
    }
  }
}
