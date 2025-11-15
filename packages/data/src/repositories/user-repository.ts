import type { User } from '@exitbook/core';
import { UserSchema, wrapError } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { KyselyDB } from '../storage/database.js';

import { BaseRepository } from './base-repository.js';

/**
 * Repository for User database operations
 */
export class UserRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'UserRepository');
  }

  /**
   * Create a new user
   */
  async create(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('users')
        .values({
          created_at: this.getCurrentDateTimeForDB(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to create user');
    }
  }

  /**
   * Find user by ID
   */
  async findById(userId: number): Promise<Result<User | undefined, Error>> {
    try {
      const row = await this.db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const userResult = this.toUser(row);
      if (userResult.isErr()) {
        return err(userResult.error);
      }

      return ok(userResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to find user by ID');
    }
  }

  /**
   * Get or create the default CLI user (id=1)
   * This is idempotent and safe to call on every import
   */
  async ensureDefaultUser(): Promise<Result<User, Error>> {
    try {
      // Try to find existing default user
      const existingResult = await this.findById(1);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      if (existingResult.value) {
        return ok(existingResult.value);
      }

      // Create default user with explicit ID
      const result = await this.db
        .insertInto('users')
        .values({
          id: 1,
          created_at: this.getCurrentDateTimeForDB(),
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();

      const userResult = this.toUser(result);
      if (userResult.isErr()) {
        return err(userResult.error);
      }

      this.logger.info('Created default CLI user (id=1)');
      return ok(userResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to ensure default user');
    }
  }

  /**
   * Convert database row to User domain model
   */
  private toUser(row: { created_at: string; id: number }): Result<User, Error> {
    const parseResult = UserSchema.safeParse({
      id: row.id,
      createdAt: new Date(row.created_at),
    });

    if (!parseResult.success) {
      return err(new Error(`Invalid user data: ${parseResult.error.message}`));
    }

    return ok(parseResult.data);
  }
}
