/* eslint-disable unicorn/no-null -- null needed for db */
import type { Account, AccountType, CursorState, ExchangeCredentials } from '@exitbook/core';
import { AccountSchema, CursorStateSchema, ExchangeCredentialsSchema } from '@exitbook/core';
import { err, ok, resultDo, resultTryAsync, type Result } from '@exitbook/core';
import type { Selectable, Updateable } from '@exitbook/sqlite';
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

/**
 * Matches the DB unique index: COALESCE(user_id, 0).
 * NULL and 0 are equivalent at the schema level — undefined in the domain maps to both.
 */
function isUnsetUserId(userId: number | null | undefined): boolean {
  return userId === null || userId === undefined || userId === 0;
}

function toAccount(row: Selectable<AccountsTable>): Result<Account, Error> {
  return resultDo(function* () {
    const credentials = yield* parseWithSchema(row.credentials, ExchangeCredentialsSchema.optional());
    const lastCursor = yield* parseWithSchema(row.last_cursor, z.record(z.string(), CursorStateSchema).optional());
    const metadata = yield* parseWithSchema(row.metadata, accountMetadataSchema);

    const parseResult = AccountSchema.safeParse({
      id: row.id,
      userId: row.user_id ?? undefined,
      parentAccountId: row.parent_account_id ?? undefined,
      accountType: row.account_type,
      sourceName: row.source_name,
      identifier: row.identifier,
      providerName: row.provider_name ?? undefined,
      credentials: credentials ?? undefined,
      lastCursor,
      metadata,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    });

    if (parseResult.success) {
      return parseResult.data;
    }
    return yield* err(`Invalid account data: ${parseResult.error.message}`);
  });
}

export class AccountRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'account-repository');
  }

  async findByIdOptional(accountId: number): Promise<Result<Account | undefined, Error>> {
    return resultTryAsync(
      async function* (self) {
        const row = await self.db.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();
        if (!row) {
          return undefined;
        }

        return yield* toAccount(row);
      },
      this,
      'Failed to find account by ID'
    );
  }

  async findBy(params: AccountKeyParams): Promise<Result<Account | undefined, Error>> {
    return resultTryAsync(
      async function* (self) {
        let query = self.db
          .selectFrom('accounts')
          .selectAll()
          .where('account_type', '=', params.accountType)
          .where('source_name', '=', params.sourceName)
          .where('identifier', '=', params.identifier);

        if (isUnsetUserId(params.userId)) {
          query = query.where((eb) => eb.or([eb('user_id', 'is', null), eb('user_id', '=', 0)]));
        } else {
          query = query.where('user_id', '=', params.userId!);
        }

        const row = await query.executeTakeFirst();
        if (!row) return undefined;

        return yield* toAccount(row);
      },
      this,
      'Failed to find account by unique constraint'
    );
  }

  async findById(accountId: number): Promise<Result<Account, Error>> {
    return resultTryAsync(
      async function* (self) {
        const account = yield* await self.findByIdOptional(accountId);
        if (!account) {
          return yield* err(`Account ${accountId} not found`);
        }

        return account;
      },
      this,
      'Failed to find account by ID'
    );
  }

  async findAll(filters?: {
    accountType?: AccountType | undefined;
    parentAccountId?: number | undefined;
    sourceName?: string | undefined;
    userId?: number | undefined;
  }): Promise<Result<Account[], Error>> {
    return resultTryAsync(
      async function* (self) {
        let query = self.db.selectFrom('accounts').selectAll();

        if (filters?.accountType) {
          query = query.where('account_type', '=', filters.accountType);
        }
        if (filters?.sourceName) {
          query = query.where('source_name', '=', filters.sourceName);
        }
        if (filters?.userId !== undefined) {
          if (isUnsetUserId(filters.userId)) {
            query = query.where((eb) => eb.or([eb('user_id', 'is', null), eb('user_id', '=', 0)]));
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
          accounts.push(yield* toAccount(row));
        }
        return accounts;
      },
      this,
      'Failed to find all accounts'
    );
  }

  async findOrCreate(params: FindOrCreateAccountParams): Promise<Result<Account, Error>> {
    return resultTryAsync(
      async function* (self) {
        if (!params.identifier || params.identifier.trim() === '') {
          yield* err('Account identifier must not be empty');
        }
        if (!params.sourceName || params.sourceName.trim() === '') {
          yield* err('Account source name must not be empty');
        }

        const existing = yield* await self.findBy({
          accountType: params.accountType,
          sourceName: params.sourceName,
          identifier: params.identifier,
          userId: params.userId,
        });

        if (existing) {
          self.logger.debug({ accountId: existing.id }, 'Found existing account');

          if (params.parentAccountId !== undefined && existing.parentAccountId !== params.parentAccountId) {
            self.logger.info(
              { accountId: existing.id, currentParent: existing.parentAccountId, newParent: params.parentAccountId },
              'Updating parent account relationship for existing account'
            );
            yield* await self.update(existing.id, { parentAccountId: params.parentAccountId });
            return yield* await self.findById(existing.id);
          }

          return existing;
        }

        let credentialsJson: string | null = null;
        if (params.credentials) {
          const validationResult = ExchangeCredentialsSchema.safeParse(params.credentials);
          if (!validationResult.success) {
            yield* err(`Invalid credentials: ${validationResult.error.message}`);
          } else {
            credentialsJson = (yield* serializeToJson(validationResult.data)) ?? null;
          }
        }

        const result = await self.db
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
            created_at: new Date().toISOString(),
            updated_at: null,
          })
          .returning(['id', 'user_id', 'account_type', 'source_name', 'identifier', 'provider_name', 'created_at'])
          .executeTakeFirstOrThrow();

        self.logger.info(
          { accountId: result.id, accountType: params.accountType, sourceName: params.sourceName },
          'Created new account'
        );

        return yield* await self.findById(result.id);
      },
      this,
      'Failed to find or create account'
    );
  }

  async update(accountId: number, updates: UpdateAccountParams): Promise<Result<void, Error>> {
    return resultTryAsync(
      async function* (self) {
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
            yield* err(`Invalid credentials: ${validationResult.error.message}`);
          } else {
            updateData.credentials = (yield* serializeToJson(validationResult.data)) ?? null;
          }
        }

        if (updates.lastCursor !== undefined) {
          const validationResult = z.record(z.string(), CursorStateSchema).safeParse(updates.lastCursor);
          if (!validationResult.success) {
            yield* err(`Invalid cursor map: ${validationResult.error.message}`);
          } else {
            updateData.last_cursor = (yield* serializeToJson(validationResult.data)) ?? null;
          }
        }

        if (updates.metadata !== undefined) {
          updateData.metadata = (yield* serializeToJson(updates.metadata)) ?? null;
        }

        const hasChanges = Object.keys(updateData).length > 1;
        if (!hasChanges) return undefined;

        await self.db.updateTable('accounts').set(updateData).where('id', '=', accountId).execute();
      },
      this,
      'Failed to update account'
    );
  }

  async updateCursor(accountId: number, operationType: string, cursor: CursorState): Promise<Result<void, Error>> {
    return resultTryAsync(
      async function* (self) {
        const account = yield* await self.findById(accountId);
        const updatedCursors = { ...(account.lastCursor ?? {}), [operationType]: cursor };
        return yield* await self.update(accountId, { lastCursor: updatedCursors });
      },
      this,
      'Failed to update cursor'
    );
  }

  async deleteByIds(accountIds: number[]): Promise<Result<number, Error>> {
    if (accountIds.length === 0) return ok(0);

    try {
      const result = await this.db.deleteFrom('accounts').where('id', 'in', accountIds).executeTakeFirst();
      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ accountIds, count }, 'Deleted accounts by IDs');
      return ok(count);
    } catch (error) {
      return err(new Error('Failed to delete accounts by IDs', { cause: error }));
    }
  }
}
