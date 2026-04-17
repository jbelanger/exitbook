/* eslint-disable unicorn/no-null -- null needed for db */
import type { Account, AccountType, ExchangeCredentials } from '@exitbook/core';
import { AccountSchema, AmbiguousAccountFingerprintRefError, ExchangeCredentialsSchema } from '@exitbook/core';
import type { CursorState } from '@exitbook/foundation';
import {
  CursorStateSchema,
  err,
  isCaseInsensitiveIdentifier,
  normalizeIdentifierForMatching,
  ok,
  resultDo,
  resultTryAsync,
  type Result,
} from '@exitbook/foundation';
import { sql } from '@exitbook/sqlite';
import type { Selectable, Updateable } from '@exitbook/sqlite';
import { z } from 'zod';

import type { AccountsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { parseWithSchema, serializeToJson } from '../utils/json-column-codec.js';

import {
  deriveCanonicalAccountFingerprint,
  type AccountIdentityParams,
  validatePersistedAccountFingerprint,
} from './account-identity-support.js';
import { BaseRepository } from './base-repository.js';

type AccountRowWithProfileKey = Selectable<AccountsTable> & { profile_key: string };

interface UpdateAccountParams {
  identifier?: string | undefined;
  name?: string | null | undefined;
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  resetCursor?: boolean | undefined;
  credentials?: ExchangeCredentials | undefined;
  lastCursor?: Record<string, CursorState> | undefined;
  metadata?: Account['metadata'] | undefined;
}

interface CreateAccountParams {
  profileId: number;
  name?: string | undefined;
  parentAccountId?: number | undefined;
  accountType: AccountType;
  platformKey: string;
  identifier: string;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
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

function normalizeAccountName(name: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Account name must not be empty'));
  }

  return ok(normalized);
}

function normalizeAccountFingerprintRef(fingerprintRef: string): Result<string, Error> {
  const normalized = fingerprintRef.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Account fingerprint ref must not be empty'));
  }

  return ok(normalized);
}

function profilesMatch(leftProfileId: number, rightProfileId: number): boolean {
  return leftProfileId === rightProfileId;
}

function toAccount(row: AccountRowWithProfileKey): Result<Account, Error> {
  return resultDo(function* () {
    const fingerprintValidationResult = validatePersistedAccountFingerprint({
      accountId: row.id,
      accountType: row.account_type,
      platformKey: row.platform_key,
      identifier: row.identifier,
      profileId: row.profile_id,
      accountFingerprint: row.account_fingerprint,
      profileKey: row.profile_key,
    });
    if (fingerprintValidationResult.isErr()) {
      return yield* err(fingerprintValidationResult.error);
    }

    const credentials = yield* parseWithSchema(row.credentials, ExchangeCredentialsSchema.optional());
    const lastCursor = yield* parseWithSchema(row.last_cursor, z.record(z.string(), CursorStateSchema).optional());
    const metadata = yield* parseWithSchema(row.metadata, accountMetadataSchema);

    const parseResult = AccountSchema.safeParse({
      id: row.id,
      profileId: row.profile_id,
      name: row.name ?? undefined,
      parentAccountId: row.parent_account_id ?? undefined,
      accountType: row.account_type,
      platformKey: row.platform_key,
      identifier: row.identifier,
      accountFingerprint: row.account_fingerprint,
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

  async findById(accountId: number): Promise<Result<Account | undefined, Error>> {
    return resultTryAsync(
      async function* (self) {
        const row = await self.baseAccountQuery().where('accounts.id', '=', accountId).executeTakeFirst();
        if (!row) {
          return undefined;
        }

        return yield* toAccount(row);
      },
      this,
      'Failed to find account by ID'
    );
  }

  async findByName(profileId: number, name: string): Promise<Result<Account | undefined, Error>> {
    return resultTryAsync(
      async function* (self) {
        const normalizedName = yield* normalizeAccountName(name);

        const row = await self
          .baseAccountQuery()
          .where('accounts.parent_account_id', 'is', null)
          .where('accounts.profile_id', '=', profileId)
          .where('accounts.name', 'is not', null)
          .where(sql`lower(name)`, '=', normalizedName)
          .executeTakeFirst();
        if (!row) {
          return undefined;
        }

        return yield* toAccount(row);
      },
      this,
      'Failed to find account by name'
    );
  }

  async findByFingerprintRef(profileId: number, fingerprintRef: string): Promise<Result<Account | undefined, Error>> {
    return resultTryAsync(
      async function* (self) {
        const normalizedRef = yield* normalizeAccountFingerprintRef(fingerprintRef);
        const rows = await self
          .baseAccountQuery()
          .where('accounts.profile_id', '=', profileId)
          .where('accounts.account_fingerprint', 'like', `${normalizedRef}%`)
          .orderBy('accounts.account_fingerprint', 'asc')
          .limit(4)
          .execute();

        if (rows.length === 0) {
          return undefined;
        }

        if (rows.length > 1) {
          const sampleMatches = rows.slice(0, 3).map((row) => row.account_fingerprint);
          return yield* err(new AmbiguousAccountFingerprintRefError(normalizedRef, sampleMatches));
        }

        return yield* toAccount(rows[0]!);
      },
      this,
      'Failed to find account by fingerprint ref'
    );
  }

  async findByIdentifier(profileId: number, identifier: string): Promise<Result<Account | undefined, Error>> {
    return resultTryAsync(
      async function* (self) {
        const normalizedIdentifier = normalizeIdentifierForMatching(identifier);
        if (normalizedIdentifier.length === 0) {
          return yield* err(new Error('Account identifier must not be empty'));
        }

        const query = self.baseAccountQuery().where('accounts.profile_id', '=', profileId);
        const row = await (
          isCaseInsensitiveIdentifier(normalizedIdentifier)
            ? query.where(sql`lower(accounts.identifier)`, '=', normalizedIdentifier)
            : query.where('accounts.identifier', '=', normalizedIdentifier)
        ).executeTakeFirst();

        if (!row) {
          return undefined;
        }

        return yield* toAccount(row);
      },
      this,
      'Failed to find account by identifier'
    );
  }

  async findByIdentity(params: AccountIdentityParams): Promise<Result<Account | undefined, Error>> {
    return resultTryAsync(
      async function* (self) {
        const accountFingerprintResult = await deriveCanonicalAccountFingerprint(self.db, params);
        if (accountFingerprintResult.isErr()) {
          return yield* err(accountFingerprintResult.error);
        }

        const row = await self
          .baseAccountQuery()
          .where('accounts.account_fingerprint', '=', accountFingerprintResult.value)
          .executeTakeFirst();
        if (!row) return undefined;

        return yield* toAccount(row);
      },
      this,
      'Failed to find account by unique constraint'
    );
  }

  async getById(accountId: number): Promise<Result<Account, Error>> {
    return resultTryAsync(
      async function* (self) {
        const account = yield* await self.findById(accountId);
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
    includeUnnamedTopLevel?: boolean | undefined;
    parentAccountId?: number | undefined;
    platformKey?: string | undefined;
    profileId?: number | undefined;
    topLevelOnly?: boolean | undefined;
  }): Promise<Result<Account[], Error>> {
    return resultTryAsync(
      async function* (self) {
        let query = self.baseAccountQuery();

        if (filters?.accountType) {
          query = query.where('accounts.account_type', '=', filters.accountType);
        }
        if (filters?.platformKey) {
          query = query.where('accounts.platform_key', '=', filters.platformKey);
        }
        if (filters?.profileId !== undefined) {
          query = query.where('accounts.profile_id', '=', filters.profileId);
        }
        if (filters?.parentAccountId !== undefined) {
          query = query.where('accounts.parent_account_id', '=', filters.parentAccountId);
        } else if (filters?.topLevelOnly) {
          query = query.where('accounts.parent_account_id', 'is', null);
        }

        if (filters?.includeUnnamedTopLevel === false) {
          query = query.where('accounts.name', 'is not', null);
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

  async create(params: CreateAccountParams): Promise<Result<Account, Error>> {
    return resultTryAsync(
      async function* (self) {
        if (!params.identifier || params.identifier.trim() === '') {
          yield* err('Account identifier must not be empty');
        }
        if (!params.platformKey || params.platformKey.trim() === '') {
          yield* err('Account platform key must not be empty');
        }
        if (params.parentAccountId !== undefined && params.name !== undefined) {
          yield* err('Child accounts must not have names');
        }
        if (params.parentAccountId !== undefined) {
          const parentAccount = yield* await self.findById(params.parentAccountId);
          if (!parentAccount) {
            yield* err(`Parent account ${params.parentAccountId} not found`);
          }
          const parentProfileId = parentAccount!.profileId;
          if (!profilesMatch(parentProfileId, params.profileId)) {
            yield* err('Child account profile must match parent account profile');
          }
        }

        let normalizedName: string | null = null;
        if (params.name !== undefined) {
          normalizedName = yield* normalizeAccountName(params.name);
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

        let metadataJson: string | null = null;
        if (params.metadata !== undefined) {
          metadataJson = (yield* serializeToJson(params.metadata)) ?? null;
        }

        const accountFingerprintResult = await deriveCanonicalAccountFingerprint(self.db, {
          profileId: params.profileId,
          accountType: params.accountType,
          platformKey: params.platformKey,
          identifier: params.identifier,
        });
        if (accountFingerprintResult.isErr()) {
          return yield* err(accountFingerprintResult.error);
        }

        const result = await self.db
          .insertInto('accounts')
          .values({
            profile_id: params.profileId,
            name: normalizedName,
            parent_account_id: params.parentAccountId ?? null,
            account_type: params.accountType,
            platform_key: params.platformKey,
            identifier: params.identifier,
            account_fingerprint: accountFingerprintResult.value,
            provider_name: params.providerName ?? null,
            credentials: credentialsJson,
            last_cursor: null,
            metadata: metadataJson,
            created_at: new Date().toISOString(),
            updated_at: null,
          })
          .returning([
            'id',
            'profile_id',
            'name',
            'account_type',
            'platform_key',
            'identifier',
            'provider_name',
            'created_at',
          ])
          .executeTakeFirstOrThrow();

        self.logger.info(
          {
            accountId: result.id,
            accountType: params.accountType,
            platformKey: params.platformKey,
            name: normalizedName ?? undefined,
          },
          'Created account'
        );

        return yield* await self.getById(result.id);
      },
      this,
      'Failed to create account'
    );
  }

  async update(accountId: number, updates: UpdateAccountParams): Promise<Result<void, Error>> {
    return resultTryAsync(
      async function* (self) {
        const updateData: Updateable<AccountsTable> = {
          updated_at: new Date().toISOString(),
        };
        const currentAccount =
          updates.parentAccountId !== undefined || updates.identifier !== undefined
            ? yield* await self.getById(accountId)
            : undefined;

        if (updates.parentAccountId !== undefined) {
          const parentAccount = yield* await self.findById(updates.parentAccountId);
          if (!parentAccount) {
            yield* err(`Parent account ${updates.parentAccountId} not found`);
          }
          if (!profilesMatch(parentAccount!.profileId, currentAccount!.profileId)) {
            yield* err('Child account profile must match parent account profile');
          }
          updateData.parent_account_id = updates.parentAccountId;
        }

        if (updates.name !== undefined) {
          updateData.name = updates.name === null ? null : yield* normalizeAccountName(updates.name);
        }

        if (updates.identifier !== undefined) {
          if (!updates.identifier || updates.identifier.trim() === '') {
            yield* err('Account identifier must not be empty');
          }
          updateData.identifier = updates.identifier;

          const accountFingerprintResult = await deriveCanonicalAccountFingerprint(self.db, {
            profileId: currentAccount!.profileId,
            accountType: currentAccount!.accountType,
            platformKey: currentAccount!.platformKey,
            identifier: updates.identifier,
          });
          if (accountFingerprintResult.isErr()) {
            return yield* err(accountFingerprintResult.error);
          }

          updateData.account_fingerprint = accountFingerprintResult.value;
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
        } else if (updates.resetCursor) {
          updateData.last_cursor = null;
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
        const account = yield* await self.getById(accountId);
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
      let count = 0;
      for (const accountId of accountIds) {
        const result = await this.db.deleteFrom('accounts').where('id', '=', accountId).executeTakeFirst();
        count += Number(result.numDeletedRows ?? 0);
      }
      this.logger.debug({ accountIds, count }, 'Deleted accounts by IDs');
      return ok(count);
    } catch (error) {
      return err(new Error('Failed to delete accounts by IDs', { cause: error }));
    }
  }

  private baseAccountQuery() {
    return this.db
      .selectFrom('accounts')
      .innerJoin('profiles', 'profiles.id', 'accounts.profile_id')
      .selectAll('accounts')
      .select('profiles.profile_key');
  }
}
