/* eslint-disable unicorn/no-null --- null needed for db */
import type { Account } from '@exitbook/core';
import type { CursorState } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { Kysely } from '@exitbook/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseSchema } from '../../database-schema.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { AccountRepository } from '../account-repository.js';

import { seedProfile } from './helpers.js';

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

  describe('findBy', () => {
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
        await repo.findBy({
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
        await repo.findBy({
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1qnone...',
          profileId: 1,
        })
      );
      expect(found).toBeUndefined();
    });

    it('handles null profileId correctly (COALESCE logic)', async () => {
      assertOk(
        await repo.create({
          profileId: undefined,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q...',
        })
      );

      const found = assertOk(
        await repo.findBy({
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1q...',
          profileId: undefined,
        })
      );
      expect(found).toBeDefined();
      expect(found?.profileId).toBeUndefined();
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
        await repo.findBy({
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
});
