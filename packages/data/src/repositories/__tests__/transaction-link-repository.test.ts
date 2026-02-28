/* eslint-disable unicorn/no-null -- null needed by db */
import { type Currency, type NewTransactionLink, parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { TransactionLinkRepository } from '../transaction-link-repository.js';

import { seedAccount, seedImportSession, seedUser } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBtcLink(sourceTxId: number, targetTxId: number): NewTransactionLink {
  return {
    sourceTransactionId: sourceTxId,
    targetTransactionId: targetTxId,
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
}

async function seedDatabase(db: KyselyDB): Promise<void> {
  await seedUser(db);
  await seedAccount(db, 1, 'exchange-api', 'test');
  await seedImportSession(db, 1, 1);

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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransactionLinkRepository', () => {
  let db: KyselyDB;
  let repo: TransactionLinkRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new TransactionLinkRepository(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('create', () => {
    it('creates a link and returns its numeric ID', async () => {
      const id = assertOk(await repo.create(makeBtcLink(1, 2)));

      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);

      const fetched = assertOk(await repo.findById(id));
      expect(fetched?.assetSymbol).toBe('BTC');
      expect(fetched?.sourceAmount.toFixed()).toBe('1');
      expect(fetched?.targetAmount.toFixed()).toBe('0.9995');
    });

    it('stores variance metadata in metadata_json', async () => {
      const link: NewTransactionLink = {
        ...makeBtcLink(1, 2),
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
        sourceAmount: parseDecimal('10.0'),
        targetAmount: parseDecimal('9.95'),
        linkType: 'blockchain_to_blockchain',
        status: 'suggested',
        metadata: { variance: '0.05', variancePct: '0.50', impliedFee: '0.05' },
      };

      const id = assertOk(await repo.create(link));
      const fetched = assertOk(await repo.findById(id));
      expect(fetched?.metadata).toEqual({ variance: '0.05', variancePct: '0.50', impliedFee: '0.05' });
    });

    it('preserves very small amounts without precision loss', async () => {
      const link = {
        ...makeBtcLink(3, 4),
        sourceAmount: parseDecimal('0.00001'),
        targetAmount: parseDecimal('0.000009'),
      };
      const id = assertOk(await repo.create(link));
      const fetched = assertOk(await repo.findById(id));
      expect(fetched?.sourceAmount.toFixed()).toBe('0.00001');
      expect(fetched?.targetAmount.toFixed()).toBe('0.000009');
    });

    it('preserves large amounts without precision loss', async () => {
      const link = {
        ...makeBtcLink(5, 6),
        linkType: 'exchange_to_exchange' as const,
        sourceAmount: parseDecimal('1000000.123456789'),
        targetAmount: parseDecimal('999999.123456789'),
      };
      const id = assertOk(await repo.create(link));
      const fetched = assertOk(await repo.findById(id));
      expect(fetched?.sourceAmount.toFixed()).toBe('1000000.123456789');
      expect(fetched?.targetAmount.toFixed()).toBe('999999.123456789');
    });
  });

  describe('createBatch', () => {
    it('creates multiple links and returns the count', async () => {
      const links: NewTransactionLink[] = [
        makeBtcLink(1, 2),
        {
          ...makeBtcLink(3, 4),
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
        },
      ];

      expect(assertOk(await repo.createBatch(links))).toBe(2);

      const all = assertOk(await repo.findAll());
      expect(all).toHaveLength(2);
      expect(all.find((l) => l.assetSymbol === 'BTC')?.sourceAmount.toFixed()).toBe('1');
      expect(all.find((l) => l.assetSymbol === 'ETH')?.sourceAmount.toFixed()).toBe('10');
    });
  });

  describe('findByTransactionIds', () => {
    it('returns all links that include the given transaction ID', async () => {
      await repo.create(makeBtcLink(7, 8));
      await repo.create({
        ...makeBtcLink(7, 9),
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
        sourceAmount: parseDecimal('5.0'),
        targetAmount: parseDecimal('4.99'),
        confidenceScore: parseDecimal('0.97'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.998'),
          timingValid: true,
          timingHours: 1.0,
        },
      });

      const links = assertOk(await repo.findByTransactionIds([7]));
      expect(links).toHaveLength(2);
      expect(links[0]?.assetSymbol).toBeDefined();
      expect(links[0]?.sourceAmount).toBeDefined();
      expect(links[0]?.targetAmount).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('returns all links with their stored fields', async () => {
      const id = assertOk(await repo.create(makeBtcLink(1, 2)));

      const all = assertOk(await repo.findAll());
      const found = all.find((l) => l.id === id);
      expect(found).toBeDefined();
      expect(found?.assetSymbol).toBe('BTC');
      expect(found?.sourceAmount.toFixed()).toBe('1');
      expect(found?.targetAmount.toFixed()).toBe('0.9995');
    });
  });

  describe('count', () => {
    it('counts all links when no filter is provided', async () => {
      await repo.create(makeBtcLink(1, 2));
      await repo.create({
        ...makeBtcLink(3, 4),
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
      });

      expect(assertOk(await repo.count())).toBe(2);
    });

    it('counts links scoped to specific account IDs', async () => {
      // Add a second account with its own transactions and links
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

      for (const id of [11, 12]) {
        await db
          .insertInto('transactions')
          .values({
            id,
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

      await repo.create(makeBtcLink(1, 2));
      await repo.create({
        ...makeBtcLink(11, 12),
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
      });

      expect(assertOk(await repo.count({ accountIds: [1] }))).toBe(1);
      expect(assertOk(await repo.count({ accountIds: [2] }))).toBe(1);
    });

    it('returns 0 when accountIds filter is empty', async () => {
      expect(assertOk(await repo.count({ accountIds: [] }))).toBe(0);
    });
  });
});
