/* eslint-disable unicorn/no-null -- null needed for db */
import type { Account, AccountType, CursorState, ExchangeCredentials, VerificationMetadata } from '@exitbook/core';
import {
  AccountSchema,
  CursorStateSchema,
  ExchangeCredentialsSchema,
  VerificationMetadataSchema,
  wrapError,
} from '@exitbook/core';
import type { Selectable, Updateable } from '@exitbook/sqlite';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import type { AccountsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { parseWithSchema, serializeToJson } from '../utils/db-utils.js';

import { BaseRepository } from './base-repository.js';

export interface AccountKeyParams {
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  userId: number | undefined;
}

export interface FindOrCreateAccountParams {
  userId: number | undefined;
  parentAccountId?: number | undefined;
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
}

export interface UpdateAccountParams {
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  lastCursor?: Record<string, CursorState> | undefined;
  lastBalanceCheckAt?: Date | undefined;
  verificationMetadata?: VerificationMetadata | undefined;
  metadata?: Account['metadata'] | undefined;
}

const accountMetadataSchema = z
  .object({
    xpub: z
      .object({
        gapLimit: z.number(),
        lastDerivedAt: z.number(),
        derivedCount: z.number(),
      })
      .optional(),
  })
  .optional();

function toAccount(row: Selectable<AccountsTable>): Result<Account, Error> {
  const credentialsResult = parseWithSchema(row.credentials, ExchangeCredentialsSchema.optional());
  if (credentialsResult.isErr()) return err(credentialsResult.error);

  const lastCursorResult = parseWithSchema(row.last_cursor, z.record(z.string(), CursorStateSchema).optional());
  if (lastCursorResult.isErr()) return err(lastCursorResult.error);

  const verificationMetadataResult = parseWithSchema(row.verification_metadata, VerificationMetadataSchema.optional());
  if (verificationMetadataResult.isErr()) return err(verificationMetadataResult.error);

  const metadataResult = parseWithSchema(row.metadata, accountMetadataSchema);
  if (metadataResult.isErr()) return err(metadataResult.error);

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
    metadata: metadataResult.value,
    createdAt: new Date(row.created_at),
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  });

  if (!parseResult.success) {
    return err(new Error(`Invalid account data: ${parseResult.error.message}`));
  }

  return ok(parseResult.data);
}

export class AccountRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'account-repository');
  }

  async findBy(params: AccountKeyParams): Promise<Result<Account | undefined, Error>> {
    try {
      let query = this.db
        .selectFrom('accounts')
        .selectAll()
        .where('account_type', '=', params.accountType)
        .where('source_name', '=', params.sourceName)
        .where('identifier', '=', params.identifier);

      const isNullOrZero = params.userId === null || params.userId === undefined || params.userId === 0;
      if (isNullOrZero) {
        query = query.where((eb) => eb.or([eb('user_id', 'is', null), eb('user_id', '=', 0)]));
      } else {
        query = query.where('user_id', '=', params.userId!);
      }

      const row = await query.executeTakeFirst();
      if (!row) return ok(undefined);

      const accountResult = toAccount(row);
      if (accountResult.isErr()) return err(accountResult.error);

      return ok(accountResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to find account by unique constraint');
    }
  }

  async findById(accountId: number): Promise<Result<Account, Error>> {
    try {
      const row = await this.db.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();

      if (!row) {
        return err(new Error(`Account ${accountId} not found`));
      }

      return toAccount(row);
    } catch (error) {
      return wrapError(error, 'Failed to find account by ID');
    }
  }

  async findAll(filters?: {
    accountType?: AccountType | undefined;
    parentAccountId?: number | undefined;
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

      if (filters?.parentAccountId !== undefined) {
        query = query.where('parent_account_id', '=', filters.parentAccountId);
      }

      const rows = await query.execute();

      const accounts: Account[] = [];
      for (const row of rows) {
        const accountResult = toAccount(row);
        if (accountResult.isErr()) return err(accountResult.error);
        accounts.push(accountResult.value);
      }

      return ok(accounts);
    } catch (error) {
      return wrapError(error, 'Failed to find all accounts');
    }
  }

  async findOrCreate(params: FindOrCreateAccountParams): Promise<Result<Account, Error>> {
    try {
      if (!params.identifier || params.identifier.trim() === '') {
        return err(new Error('Account identifier must not be empty'));
      }
      if (!params.sourceName || params.sourceName.trim() === '') {
        return err(new Error('Account source name must not be empty'));
      }

      const existingResult = await this.findBy({
        accountType: params.accountType,
        sourceName: params.sourceName,
        identifier: params.identifier,
        userId: params.userId,
      });

      if (existingResult.isErr()) return err(existingResult.error);

      if (existingResult.value) {
        const existing = existingResult.value;
        this.logger.debug({ accountId: existing.id }, 'Found existing account');

        if (params.parentAccountId !== undefined && existing.parentAccountId !== params.parentAccountId) {
          this.logger.info(
            {
              accountId: existing.id,
              currentParent: existing.parentAccountId,
              newParent: params.parentAccountId,
            },
            'Updating parent account relationship for existing account'
          );

          const updateResult = await this.update(existing.id, { parentAccountId: params.parentAccountId });
          if (updateResult.isErr()) return err(updateResult.error);

          return this.findById(existing.id);
        }

        return ok(existing);
      }

      let credentialsJson: string | null = null;
      if (params.credentials) {
        const validationResult = ExchangeCredentialsSchema.safeParse(params.credentials);
        if (!validationResult.success) {
          return err(new Error(`Invalid credentials: ${validationResult.error.message}`));
        }
        const serializedCredentials = serializeToJson(validationResult.data);
        if (serializedCredentials.isErr()) return err(serializedCredentials.error);
        credentialsJson = serializedCredentials.value ?? null;
      }

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
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .returning(['id', 'user_id', 'account_type', 'source_name', 'identifier', 'provider_name', 'created_at'])
        .executeTakeFirstOrThrow();

      this.logger.info(
        { accountId: result.id, accountType: params.accountType, sourceName: params.sourceName },
        'Created new account'
      );

      return this.findById(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to find or create account');
    }
  }

  async update(accountId: number, updates: UpdateAccountParams): Promise<Result<void, Error>> {
    try {
      const updateData: Updateable<AccountsTable> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.parentAccountId !== undefined) {
        updateData.parent_account_id = updates.parentAccountId;
      }

      if (updates.providerName !== undefined) {
        updateData.provider_name = updates.providerName;
      }

      if (updates.credentials !== undefined) {
        const validationResult = ExchangeCredentialsSchema.safeParse(updates.credentials);
        if (!validationResult.success) {
          return err(new Error(`Invalid credentials: ${validationResult.error.message}`));
        }
        const serializedCredentials = serializeToJson(validationResult.data);
        if (serializedCredentials.isErr()) return err(serializedCredentials.error);
        updateData.credentials = serializedCredentials.value ?? null;
      }

      if (updates.lastCursor !== undefined) {
        const validationResult = z.record(z.string(), CursorStateSchema).safeParse(updates.lastCursor);
        if (!validationResult.success) {
          return err(new Error(`Invalid cursor map: ${validationResult.error.message}`));
        }
        const serializedCursor = serializeToJson(validationResult.data);
        if (serializedCursor.isErr()) return err(serializedCursor.error);
        updateData.last_cursor = serializedCursor.value ?? null;
      }

      if (updates.lastBalanceCheckAt !== undefined) {
        updateData.last_balance_check_at = updates.lastBalanceCheckAt ? updates.lastBalanceCheckAt.toISOString() : null;
      }

      if (updates.verificationMetadata !== undefined) {
        const validationResult = VerificationMetadataSchema.safeParse(updates.verificationMetadata);
        if (!validationResult.success) {
          return err(new Error(`Invalid verification metadata: ${validationResult.error.message}`));
        }
        const serializedVerificationMetadata = serializeToJson(validationResult.data);
        if (serializedVerificationMetadata.isErr()) return err(serializedVerificationMetadata.error);
        updateData.verification_metadata = serializedVerificationMetadata.value ?? null;
      }

      if (updates.metadata !== undefined) {
        const serializedMetadata = serializeToJson(updates.metadata);
        if (serializedMetadata.isErr()) return err(serializedMetadata.error);
        updateData.metadata = serializedMetadata.value ?? null;
      }

      const hasChanges = Object.keys(updateData).length > 1;
      if (!hasChanges) return ok();

      await this.db.updateTable('accounts').set(updateData).where('id', '=', accountId).execute();

      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to update account');
    }
  }

  async updateCursor(accountId: number, operationType: string, cursor: CursorState): Promise<Result<void, Error>> {
    try {
      const accountResult = await this.findById(accountId);
      if (accountResult.isErr()) return err(accountResult.error);

      const updatedCursors = {
        ...(accountResult.value.lastCursor ?? {}),
        [operationType]: cursor,
      };

      return this.update(accountId, { lastCursor: updatedCursors });
    } catch (error) {
      return wrapError(error, 'Failed to update cursor');
    }
  }

  async deleteByIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) return ok(0);

      const result = await this.db.deleteFrom('accounts').where('id', 'in', accountIds).executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ accountIds, count }, 'Deleted accounts by IDs');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to delete accounts by IDs');
      return wrapError(error, 'Failed to delete accounts by IDs');
    }
  }
}
