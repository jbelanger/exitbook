/* eslint-disable unicorn/no-null --- null needed for db */
import { AmbiguousAccountFingerprintRefError, computeAccountFingerprint, type Account } from '@exitbook/core';
import type { CursorState } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { Kysely } from '@exitbook/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseSchema } from '../../database-schema.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { AccountRepository } from '../account-repository.js';

import { computeTestAccountFingerprint, seedProfile } from './helpers.js';

describe('AccountRepository', () => {
  let db: Kysely<DatabaseSchema>;
  let repo: AccountRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new AccountRepository(db);

    await seedProfile(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('getById', () => {
    it('finds an existing account', async () => {
      const created = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0x123',
        })
      );

      const found = assertOk(await repo.getById(created.id));
      expect(found.id).toBe(created.id);
      expect(found.platformKey).toBe('ethereum');
      expect(found.accountFingerprint).toBe(
        assertOk(
          computeAccountFingerprint({
            profileKey: 'default',
            accountType: 'blockchain',
            platformKey: 'ethereum',
            identifier: '0x123',
          })
        )
      );
    });

    it('returns error for non-existent account', async () => {
      const result = await repo.getById(999);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Account 999 not found');
      }
    });

    it('returns error when stored cursor fails schema validation', async () => {
      const inserted = await db
        .insertInto('accounts')
        .values({
          profile_id: 1,
          parent_account_id: null,
          account_type: 'blockchain',
          platform_key: 'bitcoin',
          identifier: 'bc1q-invalid-cursor',
          account_fingerprint: await computeTestAccountFingerprint(db, {
            profileId: 1,
            accountType: 'blockchain',
            platformKey: 'bitcoin',
            identifier: 'bc1q-invalid-cursor',
          }),
          provider_name: null,
          credentials: null,
          last_cursor: JSON.stringify({ normal: { invalid: 'shape' } }),
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await repo.getById(inserted.id);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Schema validation failed');
      }
    });

    it('returns error when stored credentials fail schema validation', async () => {
      const inserted = await db
        .insertInto('accounts')
        .values({
          profile_id: 1,
          parent_account_id: null,
          account_type: 'exchange-api',
          platform_key: 'kraken',
          identifier: 'apiKey-invalid-schema',
          account_fingerprint: await computeTestAccountFingerprint(db, {
            profileId: 1,
            accountType: 'exchange-api',
            platformKey: 'kraken',
            identifier: 'apiKey-invalid-schema',
          }),
          provider_name: null,
          credentials: JSON.stringify({ apiKey: 'key123' }), // missing apiSecret
          last_cursor: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await repo.getById(inserted.id);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Schema validation failed');
      }
    });
  });

  describe('findById', () => {
    it('returns undefined for a missing account', async () => {
      const result = await repo.findById(999);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });
  });

  describe('findByIdentity', () => {
    it('finds account by unique key fields', async () => {
      assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q...',
        })
      );

      const found = assertOk(
        await repo.findByIdentity({
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q...',
          profileId: 1,
        })
      );
      expect(found?.platformKey).toBe('bitcoin');
      expect(found?.identifier).toBe('bc1q...');
    });

    it('returns undefined for no match', async () => {
      const found = assertOk(
        await repo.findByIdentity({
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1qnone...',
          profileId: 1,
        })
      );
      expect(found).toBeUndefined();
    });

    it('persists the canonical account fingerprint for profiled accounts', async () => {
      const created = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q...',
        })
      );

      expect(created.accountFingerprint).toBe(
        assertOk(
          computeAccountFingerprint({
            profileKey: 'default',
            accountType: 'blockchain',
            platformKey: 'bitcoin',
            identifier: 'bc1q...',
          })
        )
      );
    });

    it('matches top-level exchange accounts by profile and platform, ignoring identifier and mode', async () => {
      const created = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'exchange-csv',
          platformKey: 'kraken',
          identifier: '/tmp/kraken-csv',
        })
      );

      const found = assertOk(
        await repo.findByIdentity({
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'new-api-key',
          profileId: 1,
        })
      );

      expect(found?.id).toBe(created.id);
      expect(found?.accountType).toBe('exchange-csv');
    });
  });

  describe('fingerprint integrity', () => {
    it('rejects accounts whose persisted fingerprint drifts from canonical identity', async () => {
      const wrongFingerprint = await computeTestAccountFingerprint(db, {
        profileId: 1,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-other-wallet',
      });

      const inserted = await db
        .insertInto('accounts')
        .values({
          profile_id: 1,
          parent_account_id: null,
          account_type: 'blockchain',
          platform_key: 'bitcoin',
          identifier: 'bc1q-drifted-wallet',
          account_fingerprint: wrongFingerprint,
          provider_name: null,
          credentials: null,
          last_cursor: null,
          metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await repo.findById(inserted.id);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('fingerprint drift detected');
      }
    });
  });

  describe('findByName', () => {
    it('finds a named top-level account within a profile', async () => {
      const created = assertOk(
        await repo.create({
          profileId: 1,
          name: 'kraken-main',
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'apiKey123',
        })
      );

      const found = assertOk(await repo.findByName(1, 'KRAKEN-MAIN'));

      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('kraken-main');
    });

    it('does not return child accounts by name', async () => {
      const parent = assertOk(
        await repo.create({
          profileId: 1,
          name: 'wallet-root',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub-root',
        })
      );

      assertOk(
        await repo.create({
          profileId: 1,
          parentAccountId: parent.id,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-child',
        })
      );

      const found = assertOk(await repo.findByName(1, 'bc1q-child'));
      expect(found).toBeUndefined();
    });
  });

  describe('findByFingerprintRef', () => {
    it('finds an account by a unique fingerprint prefix within a profile', async () => {
      const first = assertOk(
        await repo.create({
          profileId: 1,
          name: 'wallet-one',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-wallet-one',
        })
      );
      const second = assertOk(
        await repo.create({
          profileId: 1,
          name: 'wallet-two',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-wallet-two',
        })
      );

      const uniquePrefixLength = findUniqueFingerprintPrefixLength(first.accountFingerprint, [
        first.accountFingerprint,
        second.accountFingerprint,
      ]);
      const found = assertOk(await repo.findByFingerprintRef(1, first.accountFingerprint.slice(0, uniquePrefixLength)));

      expect(found?.id).toBe(first.id);
    });

    it('returns undefined when no fingerprint prefix matches', async () => {
      const found = assertOk(await repo.findByFingerprintRef(1, 'deadbeef'));
      expect(found).toBeUndefined();
    });

    it('rejects ambiguous fingerprint prefixes', async () => {
      const createdFingerprints: string[] = [];

      for (let index = 0; index < 17; index += 1) {
        const created = assertOk(
          await repo.create({
            profileId: 1,
            name: `wallet-${index}`,
            accountType: 'blockchain',
            platformKey: 'bitcoin',
            identifier: `bc1q-wallet-${index}`,
          })
        );
        createdFingerprints.push(created.accountFingerprint);
      }

      const prefixCounts = new Map<string, number>();
      for (const fingerprint of createdFingerprints) {
        const prefix = fingerprint.slice(0, 1);
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      }

      const ambiguousPrefix = [...prefixCounts.entries()].find(([, count]) => count > 1)?.[0];
      expect(ambiguousPrefix).toBeDefined();

      const result = await repo.findByFingerprintRef(1, ambiguousPrefix!);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(AmbiguousAccountFingerprintRefError);
        expect(result.error.message).toContain(`Account ref '${ambiguousPrefix}' is ambiguous`);
      }
    });
  });

  describe('findByIdentifier', () => {
    it('finds an account by exact identifier within a profile', async () => {
      const created = assertOk(
        await repo.create({
          profileId: 1,
          name: 'wallet-main',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-wallet-main',
        })
      );

      const found = assertOk(await repo.findByIdentifier(1, 'bc1q-wallet-main'));

      expect(found?.id).toBe(created.id);
      expect(found?.identifier).toBe('bc1q-wallet-main');
    });

    it('does not cross profile boundaries when finding by exact identifier', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'secondary',
          display_name: 'secondary',
          created_at: new Date().toISOString(),
        })
        .execute();

      assertOk(
        await repo.create({
          profileId: 2,
          name: 'wallet-main',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-shared-identifier',
        })
      );

      const found = assertOk(await repo.findByIdentifier(1, 'bc1q-shared-identifier'));

      expect(found).toBeUndefined();
    });

    it('matches EVM identifiers case-insensitively', async () => {
      const created = assertOk(
        await repo.create({
          profileId: 1,
          name: 'evm-wallet',
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
        })
      );

      const found = assertOk(await repo.findByIdentifier(1, '0xBA7DD2a5726a5A94b3556537E7212277e0E76CBf'));

      expect(found?.id).toBe(created.id);
      expect(found?.identifier).toBe('0xba7dd2a5726a5a94b3556537e7212277e0e76cbf');
    });
  });

  describe('findAll', () => {
    it('returns all accounts for a profile', async () => {
      assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q...',
        })
      );
      assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'apiKey123',
        })
      );

      const accounts = assertOk(await repo.findAll({ profileId: 1 }));
      expect(accounts).toHaveLength(2);
      expect(accounts.every((a) => a.profileId === 1)).toBe(true);
    });

    it('returns empty array for a profile with no accounts', async () => {
      const accounts = assertOk(await repo.findAll({ profileId: 999 }));
      expect(accounts).toHaveLength(0);
    });

    it('does not include accounts from other profiles', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'secondary',
          display_name: 'secondary',
          created_at: new Date().toISOString(),
        })
        .execute();
      assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q...',
        })
      );
      assertOk(
        await repo.create({
          profileId: 2,
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0x456',
        })
      );

      const accounts = assertOk(await repo.findAll({ profileId: 1 }));
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.platformKey).toBe('bitcoin');
    });

    it('returns child accounts for a parent', async () => {
      const parent = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub6C...',
        })
      );

      assertOk(
        await repo.create({
          profileId: 1,
          parentAccountId: parent.id,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q1...',
        })
      );
      assertOk(
        await repo.create({
          profileId: 1,
          parentAccountId: parent.id,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q2...',
        })
      );

      const children = assertOk(await repo.findAll({ parentAccountId: parent.id }));
      expect(children).toHaveLength(2);
      expect(children.every((a) => a.parentAccountId === parent.id)).toBe(true);
    });

    it('does not mix children across different parents', async () => {
      const p1 = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub1...',
        })
      );
      const p2 = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub2...',
        })
      );

      assertOk(
        await repo.create({
          profileId: 1,
          parentAccountId: p1.id,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-child1...',
        })
      );
      assertOk(
        await repo.create({
          profileId: 1,
          parentAccountId: p2.id,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-child2...',
        })
      );

      const children = assertOk(await repo.findAll({ parentAccountId: p1.id }));
      expect(children).toHaveLength(1);
      expect(children[0]?.identifier).toBe('bc1q-child1...');
    });

    it('lists only top-level accounts with names when requested', async () => {
      const topLevelAccount = assertOk(
        await repo.create({
          profileId: 1,
          name: 'kraken-main',
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'apiKey123',
        })
      );
      assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-unnamed-top-level',
        })
      );
      assertOk(
        await repo.create({
          profileId: 1,
          parentAccountId: topLevelAccount.id,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q-child',
        })
      );

      const accounts = assertOk(
        await repo.findAll({
          profileId: 1,
          topLevelOnly: true,
          includeUnnamedTopLevel: false,
        })
      );

      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.name).toBe('kraken-main');
      expect(accounts[0]?.parentAccountId).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a named top-level account', async () => {
      const account = assertOk(
        await repo.create({
          profileId: 1,
          name: 'ledger-wallet',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub-ledger',
          metadata: {
            xpub: {
              gapLimit: 20,
              lastDerivedAt: 0,
              derivedCount: 0,
            },
          },
        })
      );

      expect(account.name).toBe('ledger-wallet');
      expect(account.parentAccountId).toBeUndefined();
      expect(account.metadata?.xpub?.gapLimit).toBe(20);
    });

    it('rejects named child accounts', async () => {
      const parent = assertOk(
        await repo.create({
          profileId: 1,
          name: 'wallet-root',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub-parent',
        })
      );

      const result = await repo.create({
        profileId: 1,
        name: 'child-name',
        parentAccountId: parent.id,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-child',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Child accounts must not have names');
      }
    });

    it('rejects child accounts whose profile does not match the parent', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'secondary',
          display_name: 'secondary',
          created_at: new Date().toISOString(),
        })
        .execute();

      const parent = assertOk(
        await repo.create({
          profileId: 1,
          name: 'wallet-root',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub-parent',
        })
      );

      const result = await repo.create({
        profileId: 2,
        parentAccountId: parent.id,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q-child',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Child account profile must match parent account profile');
      }
    });

    it('blocks cross-profile child rows at the database layer', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'secondary',
          display_name: 'secondary',
          created_at: new Date().toISOString(),
        })
        .execute();

      const parent = assertOk(
        await repo.create({
          profileId: 1,
          name: 'wallet-root',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub-parent',
        })
      );

      await expect(
        db
          .insertInto('accounts')
          .values({
            profile_id: 2,
            parent_account_id: parent.id,
            account_type: 'blockchain',
            platform_key: 'bitcoin',
            identifier: 'bc1q-child',
            account_fingerprint: await computeTestAccountFingerprint(db, {
              profileId: 2,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'bc1q-child',
            }),
            provider_name: null,
            credentials: null,
            last_cursor: null,
            metadata: null,
            created_at: new Date().toISOString(),
            updated_at: null,
          })
          .executeTakeFirstOrThrow()
      ).rejects.toThrow('Child account profile must match parent account profile');
    });
  });

  describe('update', () => {
    let account: Account;

    beforeEach(async () => {
      const result = await repo.create({
        profileId: 1,
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1q...',
      });
      if (result.isOk()) account = result.value;
    });

    it('updates providerName', async () => {
      await repo.update(account.id, { providerName: 'mempool.space' });
      const updated = assertOk(await repo.getById(account.id));
      expect(updated.providerName).toBe('mempool.space');
    });

    it('updates credentials', async () => {
      const exchange = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'apiKey123',
          credentials: { apiKey: 'old_key', apiSecret: 'old_secret' },
        })
      );

      await repo.update(exchange.id, { credentials: { apiKey: 'new_key', apiSecret: 'new_secret' } });
      const updated = assertOk(await repo.getById(exchange.id));
      expect(updated.credentials).toEqual({ apiKey: 'new_key', apiSecret: 'new_secret' });
    });

    it('sets updatedAt', async () => {
      await repo.update(account.id, { providerName: 'new_provider' });
      const updated = assertOk(await repo.getById(account.id));
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it('treats undefined fields as no-op', async () => {
      await repo.update(account.id, { providerName: 'existing-provider' });
      const before = assertOk(await repo.getById(account.id));

      await repo.update(account.id, { providerName: undefined });
      const after = assertOk(await repo.getById(account.id));

      expect(after.providerName).toBe('existing-provider');
      expect(after.updatedAt?.toISOString()).toBe(before.updatedAt?.toISOString());
    });

    it('rejects reparenting an account under a different profile', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'secondary',
          display_name: 'secondary',
          created_at: new Date().toISOString(),
        })
        .execute();

      const foreignParent = assertOk(
        await repo.create({
          profileId: 2,
          name: 'foreign-root',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub-foreign',
        })
      );

      const result = await repo.update(account.id, { parentAccountId: foreignParent.id });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Child account profile must match parent account profile');
      }
    });

    it('updates the account name', async () => {
      await repo.update(account.id, { name: 'wallet-main' });
      const updated = assertOk(await repo.getById(account.id));
      expect(updated.name).toBe('wallet-main');
    });

    it('updates the identifier and clears cursor state when requested', async () => {
      const exchange = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'old-key',
          credentials: { apiKey: 'old-key', apiSecret: 'old-secret' },
        })
      );

      await repo.updateCursor(exchange.id, 'ledger', {
        primary: { type: 'pageToken', value: '123', providerName: 'kraken' },
        lastTransactionId: 'tx-123',
        totalFetched: 10,
      });

      await repo.update(exchange.id, {
        identifier: 'new-key',
        credentials: { apiKey: 'new-key', apiSecret: 'new-secret' },
        resetCursor: true,
      });

      const updated = assertOk(await repo.getById(exchange.id));
      expect(updated.identifier).toBe('new-key');
      expect(updated.credentials).toEqual({ apiKey: 'new-key', apiSecret: 'new-secret' });
      expect(updated.lastCursor).toBeUndefined();
    });
  });

  describe('updateCursor', () => {
    let account: Account;

    beforeEach(async () => {
      const result = await repo.create({
        profileId: 1,
        accountType: 'blockchain',
        platformKey: 'ethereum',
        identifier: '0x123',
      });
      if (result.isOk()) account = result.value;
    });

    it('sets cursor for a single operation type', async () => {
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 18_000_000 },
        lastTransactionId: 'tx123',
        totalFetched: 500,
      };

      await repo.updateCursor(account.id, 'normal', cursor);
      const updated = assertOk(await repo.getById(account.id));
      expect(updated.lastCursor).toEqual({ normal: cursor });
    });

    it('merges cursors across operation types', async () => {
      await repo.updateCursor(account.id, 'normal', {
        primary: { type: 'blockNumber', value: 18_000_000 },
        lastTransactionId: 'tx500',
        totalFetched: 500,
      });
      await repo.updateCursor(account.id, 'internal', {
        primary: { type: 'blockNumber', value: 17_950_000 },
        lastTransactionId: 'tx150',
        totalFetched: 150,
      });

      const updated = assertOk(await repo.getById(account.id));
      expect(updated.lastCursor?.['normal']?.totalFetched).toBe(500);
      expect(updated.lastCursor?.['internal']?.totalFetched).toBe(150);
    });

    it('overwrites an existing cursor for the same operation type', async () => {
      await repo.updateCursor(account.id, 'normal', {
        primary: { type: 'blockNumber', value: 18_000_000 },
        lastTransactionId: 'tx500',
        totalFetched: 500,
      });
      await repo.updateCursor(account.id, 'normal', {
        primary: { type: 'blockNumber', value: 18_001_000 },
        lastTransactionId: 'tx1000',
        totalFetched: 1000,
      });

      const updated = assertOk(await repo.getById(account.id));
      expect(updated.lastCursor?.['normal']?.totalFetched).toBe(1000);
      expect(updated.lastCursor?.['normal']?.lastTransactionId).toBe('tx1000');
    });

    it('returns error for invalid cursor shape', async () => {
      const result = await repo.updateCursor(account.id, 'normal', { invalid: 'data' } as unknown as CursorState);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid cursor map');
      }
    });
  });

  describe('resetCursors', () => {
    it('clears cursors for every account when no IDs are provided', async () => {
      const first = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0xfirst',
        })
      );
      const second = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0xsecond',
        })
      );
      const withoutCursor = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0xwithoutcursor',
        })
      );

      await repo.updateCursor(first.id, 'normal', testCursor(18_000_000, 'tx-first', 10));
      await repo.updateCursor(second.id, 'token', testCursor(18_000_100, 'tx-second', 20));

      const resetCount = assertOk(await repo.resetCursors());

      expect(resetCount).toBe(2);
      expect(assertOk(await repo.getById(first.id)).lastCursor).toBeUndefined();
      expect(assertOk(await repo.getById(second.id)).lastCursor).toBeUndefined();
      expect(assertOk(await repo.getById(withoutCursor.id)).lastCursor).toBeUndefined();
    });

    it('clears cursors only for matching account IDs', async () => {
      const first = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0xscopedfirst',
        })
      );
      const second = assertOk(
        await repo.create({
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'ethereum',
          identifier: '0xscopedsecond',
        })
      );
      const secondCursor = testCursor(18_000_100, 'tx-second', 20);

      await repo.updateCursor(first.id, 'normal', testCursor(18_000_000, 'tx-first', 10));
      await repo.updateCursor(second.id, 'token', secondCursor);

      const resetCount = assertOk(await repo.resetCursors([first.id]));

      expect(resetCount).toBe(1);
      expect(assertOk(await repo.getById(first.id)).lastCursor).toBeUndefined();
      expect(assertOk(await repo.getById(second.id)).lastCursor).toEqual({ token: secondCursor });
    });
  });
});

function testCursor(blockNumber: number, lastTransactionId: string, totalFetched: number): CursorState {
  return {
    primary: { type: 'blockNumber', value: blockNumber },
    lastTransactionId,
    totalFetched,
  };
}

function findUniqueFingerprintPrefixLength(target: string, fingerprints: string[]): number {
  for (let length = 1; length <= target.length; length += 1) {
    const prefix = target.slice(0, length);
    const matches = fingerprints.filter((fingerprint) => fingerprint.startsWith(prefix));
    if (matches.length === 1) {
      return length;
    }
  }

  return target.length;
}
