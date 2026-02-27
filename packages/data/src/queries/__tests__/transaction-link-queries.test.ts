/* eslint-disable unicorn/no-null -- null needed by db */

import { type Currency, parseDecimal, type TransactionLink } from '@exitbook/core';
import {
  closeDatabase,
  createTestDatabase,
  createTransactionLinkQueries,
  type KyselyDB,
  type TransactionLinkQueries,
} from '@exitbook/data';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('TransactionLinkQueries - ADR-004 Phase 0', () => {
  let repo: TransactionLinkQueries;
  let db: KyselyDB;

  beforeEach(async () => {
    // Create in-memory database
    db = await createTestDatabase();

    // Clear all data before each test to avoid constraint violations
    await db.deleteFrom('transaction_links').execute();
    await db.deleteFrom('transactions').execute();
    await db.deleteFrom('import_sessions').execute();

    repo = createTransactionLinkQueries(db);

    // Create default user and account for foreign key constraints
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
    await db
      .insertInto('accounts')
      .values({
        id: 1,
        user_id: 1,
        parent_account_id: null,
        account_type: 'exchange-api',
        source_name: 'test',
        identifier: 'test-api-key',
        provider_name: null,
        last_cursor: null,
        last_balance_check_at: null,
        verification_metadata: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();

    // Create dummy transactions for foreign key constraints
    await db
      .insertInto('import_sessions')
      .values({
        id: 1,
        account_id: 1,
        status: 'completed',
        started_at: new Date().toISOString(),
        transactions_imported: 0,
        transactions_skipped: 0,
        created_at: new Date().toISOString(),
      })
      .execute();

    for (let i = 1; i <= 10; i++) {
      await db
        .insertInto('transactions')
        .values({
          id: i,
          account_id: 1,
          source_name: 'test',
          source_type: 'exchange',
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          is_spam: false,
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
        })
        .execute();
    }
  });

  afterEach(async () => {
    const closeResult = await closeDatabase(db);
    if (closeResult.isErr()) {
      throw closeResult.error;
    }
  });

  describe('create', () => {
    it('should create a link with asset, sourceAmount, and targetAmount', async () => {
      const link: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9995'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        reviewedBy: 'auto',
        reviewedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await repo.create(link);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(link.id);
      }

      // Verify it was stored correctly
      const fetchResult = await repo.findById(link.id);
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk() && fetchResult.value) {
        expect(fetchResult.value.assetSymbol).toBe('BTC');
        expect(fetchResult.value?.sourceAmount?.toFixed()).toBe('1');
        expect(fetchResult.value?.targetAmount?.toFixed()).toBe('0.9995');
      }
    });

    it('should store variance metadata in metadata_json', async () => {
      const link: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
        sourceAmount: parseDecimal('10.0'),
        targetAmount: parseDecimal('9.95'),
        linkType: 'blockchain_to_blockchain',
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.995'),
          timingValid: true,
          timingHours: 2.0,
        },
        status: 'suggested',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          variance: '0.05',
          variancePct: '0.50',
          impliedFee: '0.05',
        },
      };

      const result = await repo.create(link);
      expect(result.isOk()).toBe(true);

      const fetchResult = await repo.findById(link.id);
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk() && fetchResult.value) {
        expect(fetchResult.value.metadata).toEqual({
          variance: '0.05',
          variancePct: '0.50',
          impliedFee: '0.05',
        });
      }
    });

    it('should handle very small amounts correctly', async () => {
      const link: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 3,
        targetTransactionId: 4,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('0.00001'),
        targetAmount: parseDecimal('0.000009'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.97'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9'),
          timingValid: true,
          timingHours: 1.0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await repo.create(link);
      expect(result.isOk()).toBe(true);

      const fetchResult = await repo.findById(link.id);
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk() && fetchResult.value) {
        expect(fetchResult.value.sourceAmount.toFixed()).toBe('0.00001');
        expect(fetchResult.value.targetAmount.toFixed()).toBe('0.000009');
      }
    });

    it('should handle large amounts correctly', async () => {
      const link: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 5,
        targetTransactionId: 6,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('1000000.123456789'),
        targetAmount: parseDecimal('999999.123456789'),
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.999999'),
          timingValid: true,
          timingHours: 0.1,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await repo.create(link);
      expect(result.isOk()).toBe(true);

      const fetchResult = await repo.findById(link.id);
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk() && fetchResult.value) {
        expect(fetchResult.value.sourceAmount.toFixed()).toBe('1000000.123456789');
        expect(fetchResult.value.targetAmount.toFixed()).toBe('999999.123456789');
      }
    });
  });

  describe('createBulk', () => {
    it('should create multiple links with new fields', async () => {
      const links: TransactionLink[] = [
        {
          id: uuidv4(),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
          linkType: 'exchange_to_blockchain',
          confidenceScore: parseDecimal('0.98'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.9995'),
            timingValid: true,
            timingHours: 0.5,
          },
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: uuidv4(),
          sourceTransactionId: 3,
          targetTransactionId: 4,
          assetSymbol: 'ETH' as Currency,
          sourceAssetId: 'test:eth',
          targetAssetId: 'test:eth',
          sourceAmount: parseDecimal('10.0'),
          targetAmount: parseDecimal('9.98'),
          linkType: 'blockchain_to_blockchain',
          confidenceScore: parseDecimal('0.96'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.998'),
            timingValid: true,
            timingHours: 1.0,
          },
          status: 'suggested',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = await repo.createBulk(links);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(2);
      }

      // Verify both were stored correctly
      for (const link of links) {
        const fetchResult = await repo.findById(link.id);
        expect(fetchResult.isOk()).toBe(true);
        if (fetchResult.isOk() && fetchResult.value) {
          expect(fetchResult.value.assetSymbol).toBe(link.assetSymbol);
          expect(fetchResult.value.sourceAmount.toFixed()).toBe(link.sourceAmount.toFixed());
          expect(fetchResult.value.targetAmount.toFixed()).toBe(link.targetAmount.toFixed());
        }
      }
    });
  });

  describe('findByTransactionIds', () => {
    it('should find links by related transaction IDs with amounts', async () => {
      const link1: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 7,
        targetTransactionId: 8,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9995'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const link2: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 7,
        targetTransactionId: 9,
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
        sourceAmount: parseDecimal('5.0'),
        targetAmount: parseDecimal('4.99'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.97'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.998'),
          timingValid: true,
          timingHours: 1.0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await repo.create(link1);
      await repo.create(link2);

      const result = await repo.findByTransactionIds([7]);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.assetSymbol).toBeDefined();
        expect(result.value[0]?.sourceAmount).toBeDefined();
        expect(result.value[0]?.targetAmount).toBeDefined();
      }
    });
  });

  describe('findAll', () => {
    it('should return all links with new fields', async () => {
      const link: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9995'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await repo.create(link);

      const result = await repo.findAll();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        const foundLink = result.value.find((l) => l.id === link.id);
        expect(foundLink).toBeDefined();
        expect(foundLink?.assetSymbol).toBe('BTC');
        expect(foundLink?.sourceAmount.toFixed()).toBe('1');
        expect(foundLink?.targetAmount.toFixed()).toBe('0.9995');
      }
    });
  });

  describe('count', () => {
    it('should count all links when no filters are provided', async () => {
      const link1: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9995'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const link2: TransactionLink = {
        id: uuidv4(),
        sourceTransactionId: 3,
        targetTransactionId: 4,
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
        sourceAmount: parseDecimal('5.0'),
        targetAmount: parseDecimal('4.99'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.97'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.998'),
          timingValid: true,
          timingHours: 1.0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await repo.create(link1);
      await repo.create(link2);

      const result = await repo.count();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(2);
      }
    });

    it('should count links scoped to account IDs', async () => {
      await db
        .insertInto('accounts')
        .values({
          id: 2,
          user_id: 1,
          parent_account_id: null,
          account_type: 'exchange-api',
          source_name: 'test-2',
          identifier: 'test-api-key-2',
          provider_name: null,
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .execute();

      for (const transactionId of [11, 12]) {
        await db
          .insertInto('transactions')
          .values({
            id: transactionId,
            account_id: 2,
            source_name: 'test-2',
            source_type: 'exchange',
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            is_spam: false,
            excluded_from_accounting: false,
            created_at: new Date().toISOString(),
          })
          .execute();
      }

      await repo.create({
        id: uuidv4(),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9995'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repo.create({
        id: uuidv4(),
        sourceTransactionId: 11,
        targetTransactionId: 12,
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
        sourceAmount: parseDecimal('10.0'),
        targetAmount: parseDecimal('9.95'),
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('0.96'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.995'),
          timingValid: true,
          timingHours: 0.75,
        },
        status: 'suggested',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const accountOneCount = await repo.count({ accountIds: [1] });
      expect(accountOneCount.isOk()).toBe(true);
      if (accountOneCount.isOk()) {
        expect(accountOneCount.value).toBe(1);
      }

      const accountTwoCount = await repo.count({ accountIds: [2] });
      expect(accountTwoCount.isOk()).toBe(true);
      if (accountTwoCount.isOk()) {
        expect(accountTwoCount.value).toBe(1);
      }
    });

    it('should return 0 when accountIds filter is empty', async () => {
      const result = await repo.count({ accountIds: [] });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });
  });
});
