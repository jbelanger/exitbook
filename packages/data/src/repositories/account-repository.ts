/* eslint-disable unicorn/no-null -- null needed for db */
import type { Account, AccountType, CursorState, ExchangeCredentials, VerificationMetadata } from '@exitbook/core';
import {
  AccountSchema,
  CursorStateSchema,
  ExchangeCredentialsSchema,
  VerificationMetadataSchema,
  wrapError,
} from '@exitbook/core';
import type { Selectable } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

import type { AccountsTable } from '../schema/database-schema.ts';
import type { KyselyDB } from '../storage/database.js';

import { BaseRepository } from './base-repository.js';

/**
 * Parameters for finding or creating an account
 */
export interface FindOrCreateAccountParams {
  userId: number | undefined;
  parentAccountId?: number | undefined;
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
}

/**
 * Parameters for updating an account
 */
export interface UpdateAccountParams {
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  lastCursor?: Record<string, CursorState> | undefined;
  lastBalanceCheckAt?: Date | undefined;
  verificationMetadata?: VerificationMetadata | undefined;
}

/**
 * Repository for Account database operations
 */
export class AccountRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'AccountRepository');
  }

  /**
   * Find or create an account
   * Uses the unique constraint (account_type, source_name, identifier, user_id) to ensure idempotency
   */
  async findOrCreate(params: FindOrCreateAccountParams): Promise<Result<Account, Error>> {
    try {
      // Validate required fields to prevent bad data at source
      if (!params.identifier || params.identifier.trim() === '') {
        return err(new Error('Account identifier must not be empty'));
      }
      if (!params.sourceName || params.sourceName.trim() === '') {
        return err(new Error('Account source name must not be empty'));
      }

      // First, try to find existing account
      const existingResult = await this.findByUniqueConstraint(
        params.accountType,
        params.sourceName,
        params.identifier,
        params.userId
      );

      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      if (existingResult.value) {
        const existing = existingResult.value;
        this.logger.debug({ accountId: existing.id }, 'Found existing account');

        // If a parentAccountId is provided and the existing account has a different (or null) parent,
        // update the parent relationship to maintain the hierarchy
        if (params.parentAccountId !== undefined && existing.parentAccountId !== params.parentAccountId) {
          this.logger.info(
            {
              accountId: existing.id,
              currentParent: existing.parentAccountId,
              newParent: params.parentAccountId,
            },
            'Updating parent account relationship for existing account'
          );

          const updateResult = await this.update(existing.id, {
            parentAccountId: params.parentAccountId,
          });

          if (updateResult.isErr()) {
            return err(updateResult.error);
          }

          // Fetch the updated account
          return this.findById(existing.id);
        }

        return ok(existing);
      }

      // Validate and serialize credentials if provided
      let credentialsJson: string | null = null;
      if (params.credentials) {
        const validationResult = ExchangeCredentialsSchema.safeParse(params.credentials);
        if (!validationResult.success) {
          return err(new Error(`Invalid credentials: ${validationResult.error.message}`));
        }
        credentialsJson = this.serializeToJson(validationResult.data) ?? null;
      }

      // Create new account
      const result = await this.db
        .insertInto('accounts')
        .values({
          user_id: params.userId,
          parent_account_id: params.parentAccountId ?? null,
          account_type: params.accountType,
          source_name: params.sourceName,
          identifier: params.identifier,
          provider_name: params.providerName ?? null,
          credentials: credentialsJson,
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: this.getCurrentDateTimeForDB(),
          updated_at: null,
        })
        .returning(['id', 'user_id', 'account_type', 'source_name', 'identifier', 'provider_name', 'created_at'])
        .executeTakeFirstOrThrow();

      this.logger.info(
        {
          accountId: result.id,
          accountType: params.accountType,
          sourceName: params.sourceName,
        },
        'Created new account'
      );

      // Fetch the full account with all fields
      return this.findById(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to find or create account');
    }
  }

  /**
   * Find account by ID
   */
  async findById(accountId: number): Promise<Result<Account, Error>> {
    try {
      const row = await this.db.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();

      if (!row) {
        return err(new Error(`Account ${accountId} not found`));
      }

      return this.toAccount(row);
    } catch (error) {
      return wrapError(error, 'Failed to find account by ID');
    }
  }

  /**
   * Find account by unique constraint fields
   * Matches the database unique index: (account_type, source_name, identifier, COALESCE(user_id, 0))
   */
  async findByUniqueConstraint(
    accountType: AccountType,
    sourceName: string,
    identifier: string,
    userId: number | undefined
  ): Promise<Result<Account | undefined, Error>> {
    try {
      // Build query matching the unique constraint logic
      let query = this.db
        .selectFrom('accounts')
        .selectAll()
        .where('account_type', '=', accountType)
        .where('source_name', '=', sourceName)
        .where('identifier', '=', identifier);

      // Match COALESCE(user_id, 0)
      if (userId === null || userId === undefined || userId === 0) {
        query = query.where((eb) => eb.or([eb('user_id', 'is', null), eb('user_id', '=', 0)]));
      } else {
        query = query.where('user_id', '=', userId);
      }

      const row = await query.executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const accountResult = this.toAccount(row);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }

      return ok(accountResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to find account by unique constraint');
    }
  }

  /**
   * Find all accounts for a user
   */
  async findByUser(userId: number): Promise<Result<Account[], Error>> {
    try {
      const rows = await this.db.selectFrom('accounts').selectAll().where('user_id', '=', userId).execute();

      const accounts: Account[] = [];
      for (const row of rows) {
        const accountResult = this.toAccount(row);
        if (accountResult.isErr()) {
          return err(accountResult.error);
        }
        accounts.push(accountResult.value);
      }

      return ok(accounts);
    } catch (error) {
      return wrapError(error, 'Failed to find accounts by user');
    }
  }

  /**
   * Find all accounts matching a source name
   */
  async findBySourceName(sourceName: string, userId: number): Promise<Result<Account[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('accounts')
        .selectAll()
        .where('source_name', '=', sourceName)
        .where('user_id', '=', userId)
        .execute();

      const accounts: Account[] = [];
      for (const row of rows) {
        const accountResult = this.toAccount(row);
        if (accountResult.isErr()) {
          return err(accountResult.error);
        }
        accounts.push(accountResult.value);
      }

      return ok(accounts);
    } catch (error) {
      return wrapError(error, 'Failed to find accounts by source name');
    }
  }

  /**
   * Find all child accounts for a parent account
   */
  async findByParent(parentAccountId: number): Promise<Result<Account[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('accounts')
        .selectAll()
        .where('parent_account_id', '=', parentAccountId)
        .execute();

      const accounts: Account[] = [];
      for (const row of rows) {
        const accountResult = this.toAccount(row);
        if (accountResult.isErr()) {
          return err(accountResult.error);
        }
        accounts.push(accountResult.value);
      }

      return ok(accounts);
    } catch (error) {
      return wrapError(error, 'Failed to find accounts by parent');
    }
  }

  /**
   * Find all accounts with optional filtering
   */
  async findAll(filters?: {
    accountType?: AccountType | undefined;
    sourceName?: string | undefined;
    userId?: number | null | undefined;
  }): Promise<Result<Account[], Error>> {
    try {
      let query = this.db.selectFrom('accounts').selectAll();

      if (filters?.accountType) {
        query = query.where('account_type', '=', filters.accountType);
      }

      if (filters?.sourceName) {
        query = query.where('source_name', '=', filters.sourceName);
      }

      if (filters?.userId !== undefined) {
        if (filters.userId === null) {
          query = query.where('user_id', 'is', null);
        } else {
          query = query.where('user_id', '=', filters.userId);
        }
      }

      const rows = await query.execute();

      const accounts: Account[] = [];
      for (const row of rows) {
        const accountResult = this.toAccount(row);
        if (accountResult.isErr()) {
          return err(accountResult.error);
        }
        accounts.push(accountResult.value);
      }

      return ok(accounts);
    } catch (error) {
      return wrapError(error, 'Failed to find all accounts');
    }
  }

  /**
   * Update account
   */
  async update(accountId: number, updates: UpdateAccountParams): Promise<Result<void, Error>> {
    try {
      const currentTimestamp = this.getCurrentDateTimeForDB();
      const updateData: Record<string, unknown> = {
        updated_at: currentTimestamp,
      };

      if (updates.parentAccountId !== undefined) {
        updateData.parent_account_id = updates.parentAccountId;
      }

      if (updates.providerName !== undefined) {
        updateData.provider_name = updates.providerName;
      }

      if (updates.credentials !== undefined) {
        if (updates.credentials === null) {
          updateData.credentials = null;
        } else {
          const validationResult = ExchangeCredentialsSchema.safeParse(updates.credentials);
          if (!validationResult.success) {
            return err(new Error(`Invalid credentials: ${validationResult.error.message}`));
          }
          updateData.credentials = this.serializeToJson(validationResult.data);
        }
      }

      if (updates.lastCursor !== undefined) {
        if (updates.lastCursor === null) {
          updateData.last_cursor = null;
        } else {
          const validationResult = z.record(z.string(), CursorStateSchema).safeParse(updates.lastCursor);
          if (!validationResult.success) {
            return err(new Error(`Invalid cursor map: ${validationResult.error.message}`));
          }
          updateData.last_cursor = this.serializeToJson(validationResult.data);
        }
      }

      if (updates.lastBalanceCheckAt !== undefined) {
        updateData.last_balance_check_at = updates.lastBalanceCheckAt ? updates.lastBalanceCheckAt.toISOString() : null;
      }

      if (updates.verificationMetadata !== undefined) {
        if (updates.verificationMetadata === null) {
          updateData.verification_metadata = null;
        } else {
          const validationResult = VerificationMetadataSchema.safeParse(updates.verificationMetadata);
          if (!validationResult.success) {
            return err(new Error(`Invalid verification metadata: ${validationResult.error.message}`));
          }
          updateData.verification_metadata = this.serializeToJson(validationResult.data);
        }
      }

      // Only update if there are actual changes
      const hasChanges = Object.keys(updateData).length > 1;
      if (!hasChanges) {
        return ok();
      }

      await this.db.updateTable('accounts').set(updateData).where('id', '=', accountId).execute();

      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to update account');
    }
  }

  /**
   * Update account identifier
   * This is a special case method to update the identifier field, which is part of the unique constraint.
   * Use with caution - this should only be used when merging CSV directories for exchange-csv accounts.
   */
  async updateIdentifier(accountId: number, newIdentifier: string): Promise<Result<void, Error>> {
    try {
      if (!newIdentifier || newIdentifier.trim() === '') {
        return err(new Error('Account identifier must not be empty'));
      }

      const currentTimestamp = this.getCurrentDateTimeForDB();

      await this.db
        .updateTable('accounts')
        .set({
          identifier: newIdentifier,
          updated_at: currentTimestamp,
        })
        .where('id', '=', accountId)
        .execute();

      this.logger.info({ accountId, newIdentifier }, 'Updated account identifier');
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to update account identifier');
    }
  }

  /**
   * Update cursor for a specific operation type
   * Merges with existing cursors to support multi-operation imports
   */
  async updateCursor(accountId: number, operationType: string, cursor: CursorState): Promise<Result<void, Error>> {
    try {
      // Load current account
      const accountResult = await this.findById(accountId);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }

      const account = accountResult.value;

      // Merge with existing cursors
      const updatedCursors = {
        ...(account.lastCursor ?? {}),
        [operationType]: cursor,
      };

      // Update via general update method
      return this.update(accountId, { lastCursor: updatedCursors });
    } catch (error) {
      return wrapError(error, 'Failed to update cursor');
    }
  }

  /**
   * Convert database row to Account domain model
   */
  private toAccount(row: Selectable<AccountsTable>): Result<Account, Error> {
    // Parse credentials
    const credentialsResult = this.parseWithSchema(row.credentials, ExchangeCredentialsSchema.optional());
    if (credentialsResult.isErr()) {
      return err(credentialsResult.error);
    }

    // Parse last cursor
    const lastCursorResult = this.parseWithSchema(row.last_cursor, z.record(z.string(), CursorStateSchema).optional());
    if (lastCursorResult.isErr()) {
      return err(lastCursorResult.error);
    }

    // Parse verification metadata
    const verificationMetadataResult = this.parseWithSchema(
      row.verification_metadata,
      VerificationMetadataSchema.optional()
    );
    if (verificationMetadataResult.isErr()) {
      return err(verificationMetadataResult.error);
    }

    // Construct and validate account (convert null to undefined for optional fields)
    const parseResult = AccountSchema.safeParse({
      id: row.id,
      userId: row.user_id ?? undefined,
      parentAccountId: row.parent_account_id ?? undefined,
      accountType: row.account_type,
      sourceName: row.source_name,
      identifier: row.identifier,
      providerName: row.provider_name ?? undefined,
      credentials: credentialsResult.value ?? undefined,
      lastCursor: lastCursorResult.value,
      lastBalanceCheckAt: row.last_balance_check_at ? new Date(row.last_balance_check_at) : undefined,
      verificationMetadata: verificationMetadataResult.value,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    });

    if (!parseResult.success) {
      return err(new Error(`Invalid account data: ${parseResult.error.message}`));
    }

    return ok(parseResult.data);
  }
}
