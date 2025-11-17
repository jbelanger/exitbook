import type { Account, CursorState } from '@exitbook/core';
import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AccountRepository } from '../account-repository.js';

describe('AccountRepository', () => {
  let db: KyselyDB;
  let repository: AccountRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new AccountRepository(db);

    // Create default user for tests
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('findOrCreate', () => {
    it('should create a new blockchain account', async () => {
      const result = await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
        providerName: 'blockstream',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBeGreaterThan(0);
        expect(result.value.userId).toBe(1);
        expect(result.value.accountType).toBe('blockchain');
        expect(result.value.sourceName).toBe('bitcoin');
        expect(result.value.identifier).toBe('bc1q...');
        expect(result.value.providerName).toBe('blockstream');
        expect(result.value.createdAt).toBeInstanceOf(Date);
      }
    });

    it('should create a new exchange-api account with credentials', async () => {
      const result = await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey123',
        credentials: {
          apiKey: 'key123',
          apiSecret: 'secret456',
        },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.accountType).toBe('exchange-api');
        expect(result.value.sourceName).toBe('kraken');
        expect(result.value.identifier).toBe('apiKey123');
        expect(result.value.credentials).toEqual({
          apiKey: 'key123',
          apiSecret: 'secret456',
        });
      }
    });

    it('should return existing account instead of creating duplicate', async () => {
      // Create first account
      const firstResult = await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'ethereum',
        identifier: '0x123',
      });

      expect(firstResult.isOk()).toBe(true);

      if (firstResult.isOk()) {
        const firstId = firstResult.value.id;
        const firstCreatedAt = firstResult.value.createdAt;

        // Try to create same account again
        const secondResult = await repository.findOrCreate({
          userId: 1,
          accountType: 'blockchain',
          sourceName: 'ethereum',
          identifier: '0x123',
        });

        expect(secondResult.isOk()).toBe(true);
        if (secondResult.isOk()) {
          // Should return same account
          expect(secondResult.value.id).toBe(firstId);
          expect(secondResult.value.createdAt).toEqual(firstCreatedAt);
        }

        // Verify only one account exists
        const accounts = await db.selectFrom('accounts').selectAll().execute();
        expect(accounts).toHaveLength(1);
      }
    });

    it('should allow multiple accounts on same exchange with different API keys (ADR-007 Use Case 1)', async () => {
      // Personal account
      const personalResult = await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey_personal',
      });

      // Business account (different API key)
      const businessResult = await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey_business',
      });

      expect(personalResult.isOk()).toBe(true);
      expect(businessResult.isOk()).toBe(true);

      if (personalResult.isOk() && businessResult.isOk()) {
        // Should be different accounts
        expect(personalResult.value.id).not.toBe(businessResult.value.id);
        expect(personalResult.value.identifier).toBe('apiKey_personal');
        expect(businessResult.value.identifier).toBe('apiKey_business');

        // Both should be kraken accounts
        expect(personalResult.value.sourceName).toBe('kraken');
        expect(businessResult.value.sourceName).toBe('kraken');
      }
    });

    it('should allow exchange-api and exchange-csv accounts on same exchange', async () => {
      // API account
      const apiResult = await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey123',
      });

      // CSV account (same exchange, different type)
      const csvResult = await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-csv',
        sourceName: 'kraken',
        identifier: '/path/to/csv',
      });

      expect(apiResult.isOk()).toBe(true);
      expect(csvResult.isOk()).toBe(true);

      if (apiResult.isOk() && csvResult.isOk()) {
        // Should be different accounts
        expect(apiResult.value.id).not.toBe(csvResult.value.id);
        expect(apiResult.value.accountType).toBe('exchange-api');
        expect(csvResult.value.accountType).toBe('exchange-csv');
      }
    });

    it('should support tracking external accounts with null userId (ADR-007 Use Case 3)', async () => {
      const result = await repository.findOrCreate({
        userId: undefined,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1qscammer...',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.userId).toBeUndefined();
        expect(result.value.identifier).toBe('bc1qscammer...');
      }
    });

    it('should reject invalid credentials', async () => {
      const result = await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey123',
        credentials: { invalid: 123 } as unknown as Record<string, string>, // Invalid - should be string values
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid credentials');
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findById', () => {
    it('should find an existing account by ID', async () => {
      const createResult = await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'ethereum',
        identifier: '0x123',
      });

      expect(createResult.isOk()).toBe(true);

      if (createResult.isOk()) {
        const accountId = createResult.value.id;
        const result = await repository.findById(accountId);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.id).toBe(accountId);
          expect(result.value.sourceName).toBe('ethereum');
        }
      }
    });

    it('should return error for non-existent account', async () => {
      const result = await repository.findById(999);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Account 999 not found');
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.findById(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findByUniqueConstraint', () => {
    it('should find account by unique constraint fields', async () => {
      await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      const result = await repository.findByUniqueConstraint('blockchain', 'bitcoin', 'bc1q...', 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeDefined();
        expect(result.value?.sourceName).toBe('bitcoin');
        expect(result.value?.identifier).toBe('bc1q...');
      }
    });

    it('should return undefined for non-matching account', async () => {
      const result = await repository.findByUniqueConstraint('blockchain', 'bitcoin', 'bc1qnone...', 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should handle null userId correctly (COALESCE logic)', async () => {
      // Create account with null userId
      await repository.findOrCreate({
        userId: undefined,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      const result = await repository.findByUniqueConstraint('blockchain', 'bitcoin', 'bc1q...', undefined);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeDefined();
        expect(result.value?.userId).toBeUndefined();
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.findByUniqueConstraint('blockchain', 'bitcoin', 'bc1q...', 1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findByUser', () => {
    it('should find all accounts for a user', async () => {
      await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey123',
      });

      const result = await repository.findByUser(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((a) => a.userId === 1)).toBe(true);
      }
    });

    it('should return empty array for user with no accounts', async () => {
      const result = await repository.findByUser(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should not include accounts from other users', async () => {
      // Create second user
      await db.insertInto('users').values({ id: 2, created_at: new Date().toISOString() }).execute();

      await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      await repository.findOrCreate({
        userId: 2,
        accountType: 'blockchain',
        sourceName: 'ethereum',
        identifier: '0x456',
      });

      const result = await repository.findByUser(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.sourceName).toBe('bitcoin');
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.findByUser(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('update', () => {
    let account: Account;

    beforeEach(async () => {
      const result = await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });

      if (result.isOk()) {
        account = result.value;
      }
    });

    it('should update providerName', async () => {
      const result = await repository.update(account.id, {
        providerName: 'mempool.space',
      });

      expect(result.isOk()).toBe(true);

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.providerName).toBe('mempool.space');
      }
    });

    it('should update derivedAddresses for xpub wallets (ADR-007 Use Case 2)', async () => {
      const result = await repository.update(account.id, {
        derivedAddresses: ['bc1q1...', 'bc1q2...', 'bc1q3...'],
      });

      expect(result.isOk()).toBe(true);

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.derivedAddresses).toEqual(['bc1q1...', 'bc1q2...', 'bc1q3...']);
      }
    });

    it('should update lastBalanceCheckAt', async () => {
      const checkTime = new Date('2025-01-15T10:30:00Z');
      const result = await repository.update(account.id, {
        lastBalanceCheckAt: checkTime,
      });

      expect(result.isOk()).toBe(true);

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.lastBalanceCheckAt).toEqual(checkTime);
      }
    });

    it('should update verificationMetadata', async () => {
      const metadata = {
        source_params: {
          blockchain: 'bitcoin',
          address: 'bc1q...',
        },
        current_balance: {
          BTC: '1.5',
        },
        last_verification: {
          status: 'match' as const,
          verified_at: '2025-01-15T10:30:00Z',
          calculated_balance: {
            BTC: '1.5',
          },
        },
      };

      const result = await repository.update(account.id, {
        verificationMetadata: metadata,
      });

      expect(result.isOk()).toBe(true);

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.verificationMetadata).toEqual(metadata);
      }
    });

    it('should update credentials', async () => {
      const exchangeResult = await repository.findOrCreate({
        userId: 1,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'apiKey123',
        credentials: {
          apiKey: 'old_key',
          apiSecret: 'old_secret',
        },
      });

      if (exchangeResult.isOk()) {
        const result = await repository.update(exchangeResult.value.id, {
          credentials: {
            apiKey: 'new_key',
            apiSecret: 'new_secret',
          },
        });

        expect(result.isOk()).toBe(true);

        const updated = await repository.findById(exchangeResult.value.id);
        if (updated.isOk()) {
          expect(updated.value.credentials).toEqual({
            apiKey: 'new_key',
            apiSecret: 'new_secret',
          });
        }
      }
    });

    it('should set updated_at timestamp', async () => {
      const result = await repository.update(account.id, {
        providerName: 'new_provider',
      });

      expect(result.isOk()).toBe(true);

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('should allow setting fields to null', async () => {
      const result = await repository.update(account.id, {
        providerName: undefined,
        derivedAddresses: undefined,
      });

      expect(result.isOk()).toBe(true);

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.providerName).toBeUndefined();
        expect(updated.value.derivedAddresses).toBeUndefined();
      }
    });

    it('should reject invalid credentials', async () => {
      const result = await repository.update(account.id, {
        credentials: { invalid: 123 } as unknown as Record<string, string>,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid credentials');
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.update(account.id, {
        providerName: 'test',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('updateCursor', () => {
    let account: Account;

    beforeEach(async () => {
      const result = await repository.findOrCreate({
        userId: 1,
        accountType: 'blockchain',
        sourceName: 'ethereum',
        identifier: '0x123',
      });

      if (result.isOk()) {
        account = result.value;
      }
    });

    it('should set cursor for single operation type', async () => {
      const cursor = {
        primary: {
          type: 'blockNumber' as const,
          value: 18000000,
        },
        lastTransactionId: 'tx123',
        totalFetched: 500,
      };

      const result = await repository.updateCursor(account.id, 'normal', cursor);

      expect(result.isOk()).toBe(true);

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.lastCursor).toEqual({
          normal: cursor,
        });
      }
    });

    it('should merge cursors for multiple operation types (ADR-007 streaming imports)', async () => {
      // Set cursor for normal transactions
      await repository.updateCursor(account.id, 'normal', {
        primary: {
          type: 'blockNumber' as const,
          value: 18000000,
        },
        lastTransactionId: 'tx500',
        totalFetched: 500,
      });

      // Set cursor for internal transactions
      await repository.updateCursor(account.id, 'internal', {
        primary: {
          type: 'blockNumber' as const,
          value: 17950000,
        },
        lastTransactionId: 'tx150',
        totalFetched: 150,
      });

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.lastCursor?.normal).toBeDefined();
        expect(updated.value.lastCursor?.internal).toBeDefined();
        expect(updated.value.lastCursor?.normal?.totalFetched).toBe(500);
        expect(updated.value.lastCursor?.internal?.totalFetched).toBe(150);
      }
    });

    it('should update existing cursor for operation type', async () => {
      // Set initial cursor
      await repository.updateCursor(account.id, 'normal', {
        primary: {
          type: 'blockNumber' as const,
          value: 18000000,
        },
        lastTransactionId: 'tx500',
        totalFetched: 500,
      });

      // Update same operation type with new cursor
      await repository.updateCursor(account.id, 'normal', {
        primary: {
          type: 'blockNumber' as const,
          value: 18001000,
        },
        lastTransactionId: 'tx1000',
        totalFetched: 1000,
      });

      const updated = await repository.findById(account.id);
      if (updated.isOk()) {
        expect(updated.value.lastCursor?.normal?.totalFetched).toBe(1000);
        expect(updated.value.lastCursor?.normal?.lastTransactionId).toBe('tx1000');
      }
    });

    it('should reject invalid cursor data', async () => {
      const result = await repository.updateCursor(account.id, 'normal', { invalid: 'data' } as unknown as CursorState);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid cursor map');
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.updateCursor(account.id, 'normal', {
        primary: {
          type: 'blockNumber' as const,
          value: 1,
        },
        lastTransactionId: 'tx1',
        totalFetched: 100,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
