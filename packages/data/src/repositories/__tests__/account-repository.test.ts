/* eslint-disable unicorn/no-null --- null needed for db */
import type { Account, CursorState } from '@exitbook/core';
import { type DatabaseSchema } from '@exitbook/data';
import type { Kysely } from '@exitbook/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, unwrapOk } from '../../__tests__/test-utils.js';
import { AccountRepository } from '../account-repository.js';

import { seedUser } from './helpers.js';

describe('AccountRepository', () => {
  let db: Kysely<DatabaseSchema>;
  let repo: AccountRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new AccountRepository(db);

    await seedUser(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('findOrCreate', () => {
    it('creates a new blockchain account', async () => {
      const account = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'bc1q...',
          providerName: 'blockstream',
        })
      );

      expect(account.id).toBeGreaterThan(0);
      expect(account.userId).toBe(1);
      expect(account.accountType).toBe('blockchain');
      expect(account.sourceName).toBe('bitcoin');
      expect(account.identifier).toBe('bc1q...');
      expect(account.providerName).toBe('blockstream');
      expect(account.createdAt).toBeInstanceOf(Date);
    });

    it('creates an exchange-api account with credentials', async () => {
      const account = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'exchange-api',
          sourceName: 'kraken',
          identifier: 'apiKey123',
          credentials: { apiKey: 'key123', apiSecret: 'secret456' },
        })
      );

      expect(account.accountType).toBe('exchange-api');
      expect(account.credentials).toEqual({ apiKey: 'key123', apiSecret: 'secret456' });
    });

    it('returns existing account instead of creating a duplicate', async () => {
      const first = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'ethereum',
          identifier: '0x123',
        })
      );

      const second = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'ethereum',
          identifier: '0x123',
        })
      );

      expect(second.id).toBe(first.id);
      expect(second.createdAt).toEqual(first.createdAt);

      const rows = await db.selectFrom('accounts').selectAll().execute();
      expect(rows).toHaveLength(1);
    });

    it('allows multiple accounts on the same exchange with different identifiers (ADR-007 Use Case 1)', async () => {
      const personal = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'exchange-api',
          sourceName: 'kraken',
          identifier: 'apiKey_personal',
        })
      );
      const business = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'exchange-api',
          sourceName: 'kraken',
          identifier: 'apiKey_business',
        })
      );

      expect(personal.id).not.toBe(business.id);
    });

    it('allows exchange-api and exchange-csv accounts on the same exchange', async () => {
      const api = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'exchange-api',
          sourceName: 'kraken',
          identifier: 'apiKey123',
        })
      );
      const csv = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'exchange-csv',
          sourceName: 'kraken',
          identifier: '/path/to/csv',
        })
      );

      expect(api.id).not.toBe(csv.id);
      expect(api.accountType).toBe('exchange-api');
      expect(csv.accountType).toBe('exchange-csv');
    });

    it('supports external accounts with no userId (ADR-007 Use Case 3)', async () => {
      const account = unwrapOk(
        await repo.findOrCreate({
          userId: undefined,
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'bc1qscammer...',
        })
      );

      expect(account.userId).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('finds an existing account', async () => {
      const created = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'ethereum',
          identifier: '0x123',
        })
      );

      const found = unwrapOk(await repo.findById(created.id));
      expect(found.id).toBe(created.id);
      expect(found.sourceName).toBe('ethereum');
    });

    it('returns error for non-existent account', async () => {
      const result = await repo.findById(999);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Account 999 not found');
      }
    });

    it('returns error when stored cursor fails schema validation', async () => {
      const inserted = await db
        .insertInto('accounts')
        .values({
          user_id: 1,
          parent_account_id: null,
          account_type: 'blockchain',
          source_name: 'bitcoin',
          identifier: 'bc1q-invalid-cursor',
          provider_name: null,
          credentials: null,
          last_cursor: JSON.stringify({ normal: { invalid: 'shape' } }),
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await repo.findById(inserted.id);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Schema validation failed');
      }
    });

    it('returns error when stored credentials fail schema validation', async () => {
      const inserted = await db
        .insertInto('accounts')
        .values({
          user_id: 1,
          parent_account_id: null,
          account_type: 'exchange-api',
          source_name: 'kraken',
          identifier: 'apiKey-invalid-schema',
          provider_name: null,
          credentials: JSON.stringify({ apiKey: 'key123' }), // missing apiSecret
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await repo.findById(inserted.id);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Schema validation failed');
      }
    });
  });

  describe('findBy', () => {
    it('finds account by unique key fields', async () => {
      await repo.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      const found = unwrapOk(
        await repo.findBy({
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'bc1q...',
          userId: 1,
        })
      );
      expect(found?.sourceName).toBe('bitcoin');
      expect(found?.identifier).toBe('bc1q...');
    });

    it('returns undefined for no match', async () => {
      const found = unwrapOk(
        await repo.findBy({
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'bc1qnone...',
          userId: 1,
        })
      );
      expect(found).toBeUndefined();
    });

    it('handles null userId correctly (COALESCE logic)', async () => {
      await repo.findOrCreate({
        userId: undefined,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      const found = unwrapOk(
        await repo.findBy({
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'bc1q...',
          userId: undefined,
        })
      );
      expect(found).toBeDefined();
      expect(found?.userId).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('returns all accounts for a user', async () => {
      await repo.findOrCreate({ userId: 1, accountType: 'blockchain', sourceName: 'bitcoin', identifier: 'bc1q...' });
      await repo.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey123',
      });

      const accounts = unwrapOk(await repo.findAll({ userId: 1 }));
      expect(accounts).toHaveLength(2);
      expect(accounts.every((a) => a.userId === 1)).toBe(true);
    });

    it('returns empty array for a user with no accounts', async () => {
      const accounts = unwrapOk(await repo.findAll({ userId: 999 }));
      expect(accounts).toHaveLength(0);
    });

    it('does not include accounts from other users', async () => {
      await db.insertInto('users').values({ id: 2, created_at: new Date().toISOString() }).execute();
      await repo.findOrCreate({ userId: 1, accountType: 'blockchain', sourceName: 'bitcoin', identifier: 'bc1q...' });
      await repo.findOrCreate({ userId: 2, accountType: 'blockchain', sourceName: 'ethereum', identifier: '0x456' });

      const accounts = unwrapOk(await repo.findAll({ userId: 1 }));
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.sourceName).toBe('bitcoin');
    });

    it('returns child accounts for a parent', async () => {
      const parent = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'xpub6C...',
        })
      );

      await repo.findOrCreate({
        userId: 1,
        parentAccountId: parent.id,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q1...',
      });
      await repo.findOrCreate({
        userId: 1,
        parentAccountId: parent.id,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q2...',
      });

      const children = unwrapOk(await repo.findAll({ parentAccountId: parent.id }));
      expect(children).toHaveLength(2);
      expect(children.every((a) => a.parentAccountId === parent.id)).toBe(true);
    });

    it('does not mix children across different parents', async () => {
      const p1 = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'xpub1...',
        })
      );
      const p2 = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'xpub2...',
        })
      );

      await repo.findOrCreate({
        userId: 1,
        parentAccountId: p1.id,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q-child1...',
      });
      await repo.findOrCreate({
        userId: 1,
        parentAccountId: p2.id,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q-child2...',
      });

      const children = unwrapOk(await repo.findAll({ parentAccountId: p1.id }));
      expect(children).toHaveLength(1);
      expect(children[0]?.identifier).toBe('bc1q-child1...');
    });
  });

  describe('update', () => {
    let account: Account;

    beforeEach(async () => {
      const result = await repo.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });
      if (result.isOk()) account = result.value;
    });

    it('updates providerName', async () => {
      await repo.update(account.id, { providerName: 'mempool.space' });
      const updated = unwrapOk(await repo.findById(account.id));
      expect(updated.providerName).toBe('mempool.space');
    });

    it('updates lastBalanceCheckAt', async () => {
      const checkTime = new Date('2025-01-15T10:30:00Z');
      await repo.update(account.id, { lastBalanceCheckAt: checkTime });
      const updated = unwrapOk(await repo.findById(account.id));
      expect(updated.lastBalanceCheckAt).toEqual(checkTime);
    });

    it('updates verificationMetadata', async () => {
      const metadata = {
        source_params: { blockchain: 'bitcoin', address: 'bc1q...' },
        current_balance: { BTC: '1.5' },
        last_verification: {
          status: 'match' as const,
          verified_at: '2025-01-15T10:30:00Z',
          calculated_balance: { BTC: '1.5' },
        },
      };
      await repo.update(account.id, { verificationMetadata: metadata });
      const updated = unwrapOk(await repo.findById(account.id));
      expect(updated.verificationMetadata).toEqual(metadata);
    });

    it('updates credentials', async () => {
      const exchange = unwrapOk(
        await repo.findOrCreate({
          userId: 1,
          accountType: 'exchange-api',
          sourceName: 'kraken',
          identifier: 'apiKey123',
          credentials: { apiKey: 'old_key', apiSecret: 'old_secret' },
        })
      );

      await repo.update(exchange.id, { credentials: { apiKey: 'new_key', apiSecret: 'new_secret' } });
      const updated = unwrapOk(await repo.findById(exchange.id));
      expect(updated.credentials).toEqual({ apiKey: 'new_key', apiSecret: 'new_secret' });
    });

    it('sets updatedAt', async () => {
      await repo.update(account.id, { providerName: 'new_provider' });
      const updated = unwrapOk(await repo.findById(account.id));
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it('treats undefined fields as no-op', async () => {
      await repo.update(account.id, { providerName: 'existing-provider' });
      const before = unwrapOk(await repo.findById(account.id));

      await repo.update(account.id, { providerName: undefined });
      const after = unwrapOk(await repo.findById(account.id));

      expect(after.providerName).toBe('existing-provider');
      expect(after.updatedAt?.toISOString()).toBe(before.updatedAt?.toISOString());
    });
  });

  describe('updateCursor', () => {
    let account: Account;

    beforeEach(async () => {
      const result = await repo.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'ethereum',
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
      const updated = unwrapOk(await repo.findById(account.id));
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

      const updated = unwrapOk(await repo.findById(account.id));
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

      const updated = unwrapOk(await repo.findById(account.id));
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
