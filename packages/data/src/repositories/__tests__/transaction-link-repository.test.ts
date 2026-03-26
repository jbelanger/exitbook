/* eslint-disable unicorn/no-null -- null needed by db */
import type { NewTransactionLink } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { TransactionLinkRepository } from '../transaction-link-repository.js';

import { seedAccount, seedImportSession, seedTxFingerprint, seedProfile } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBtcLink(sourceTxId: number, targetTxId: number): NewTransactionLink {
  return {
    sourceTransactionId: sourceTxId,
    targetTransactionId: targetTxId,
    assetSymbol: 'BTC' as Currency,
    sourceAssetId: 'exchange:kraken:btc',
    targetAssetId: 'blockchain:bitcoin:native',
    sourceAmount: parseDecimal('1.0'),
    targetAmount: parseDecimal('0.9995'),
    sourceMovementFingerprint: `movement:exchange:kraken:${sourceTxId}:outflow:0`,
    targetMovementFingerprint: `movement:blockchain:bitcoin:${targetTxId}:inflow:0`,
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
  await seedProfile(db);
  await seedAccount(db, 1, 'exchange-api', 'test');
  await seedImportSession(db, 1, 1);

  for (let i = 1; i <= 10; i++) {
    const identityReference = `test-tx-${i}`;
    await db
      .insertInto('transactions')
      .values({
        id: i,
        account_id: 1,
        platform_key: 'test',
        source_type: 'exchange',
        tx_fingerprint: seedTxFingerprint('test', 1, identityReference),
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

    it('round-trips movement fingerprints', async () => {
      const id = assertOk(
        await repo.create({
          ...makeBtcLink(1, 2),
          sourceMovementFingerprint: 'movement:kraken:withdrawal-1:outflow:0',
          targetMovementFingerprint: 'movement:blockchain:bitcoin:deposit-2:inflow:0',
        })
      );

      const fetched = assertOk(await repo.findById(id));
      expect(fetched?.sourceMovementFingerprint).toBe('movement:kraken:withdrawal-1:outflow:0');
      expect(fetched?.targetMovementFingerprint).toBe('movement:blockchain:bitcoin:deposit-2:inflow:0');
    });

    it('stores variance metadata separately from implied fee amount', async () => {
      const link: NewTransactionLink = {
        ...makeBtcLink(1, 2),
        assetSymbol: 'ETH' as Currency,
        sourceAmount: parseDecimal('10.0'),
        targetAmount: parseDecimal('9.95'),
        impliedFeeAmount: parseDecimal('0.05'),
        linkType: 'blockchain_to_blockchain',
        status: 'suggested',
        metadata: {
          variance: '0.05',
          variancePct: '0.50',
          transferProposalKey: 'partial-target:v1:movement:blockchain:bitcoin:deposit-2:inflow:0',
        },
      };

      const id = assertOk(await repo.create(link));
      const fetched = assertOk(await repo.findById(id));
      expect(fetched?.impliedFeeAmount?.toFixed()).toBe('0.05');
      expect(fetched?.metadata).toEqual({
        variance: '0.05',
        variancePct: '0.50',
        transferProposalKey: 'partial-target:v1:movement:blockchain:bitcoin:deposit-2:inflow:0',
      });
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

    it('round-trips blockchain_to_exchange link types', async () => {
      const id = assertOk(
        await repo.create({
          ...makeBtcLink(5, 6),
          linkType: 'blockchain_to_exchange',
          sourceAssetId: 'blockchain:bitcoin:native',
          targetAssetId: 'exchange:kraken:btc',
        })
      );

      const fetched = assertOk(await repo.findById(id));
      expect(fetched?.linkType).toBe('blockchain_to_exchange');
    });
  });

  describe('createBatch', () => {
    it('creates multiple links and returns the count', async () => {
      const links: NewTransactionLink[] = [
        makeBtcLink(1, 2),
        {
          ...makeBtcLink(3, 4),
          assetSymbol: 'ETH' as Currency,
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

    it('handles large batch inserts without exceeding SQLite variable limits', async () => {
      const links: NewTransactionLink[] = Array.from({ length: 250 }, (_, index) => ({
        ...makeBtcLink((index % 5) + 1, (index % 5) + 6),
        sourceMovementFingerprint: `movement:batch:${index}:source`,
        targetMovementFingerprint: `movement:batch:${index}:target`,
        metadata: {
          variance: '0.0005',
          variancePct: '0.05',
          transferProposalKey: `proposal:${index}`,
        },
      }));

      expect(assertOk(await repo.createBatch(links))).toBe(250);
      expect(assertOk(await repo.count())).toBe(250);
    });
  });

  describe('findByTransactionIds', () => {
    it('returns all links that include the given transaction ID', async () => {
      await repo.create(makeBtcLink(7, 8));
      await repo.create({
        ...makeBtcLink(7, 9),
        assetSymbol: 'ETH' as Currency,
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

    it('handles large transaction ID filters without exceeding SQLite variable limits', async () => {
      await repo.create(makeBtcLink(1, 2));
      await repo.create(makeBtcLink(3, 4));

      const transactionIds = Array.from({ length: 1_200 }, (_, index) => index + 1);
      const links = assertOk(await repo.findByTransactionIds(transactionIds));

      expect(links).toHaveLength(2);
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

    it('filters links by profile ownership', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'business',
          display_name: 'business',
          created_at: new Date().toISOString(),
        })
        .execute();
      await seedAccount(db, 2, 'exchange-api', 'business', { profileId: 2 });

      for (const id of [11, 12]) {
        const identityReference = `business-tx-${id}`;
        await db
          .insertInto('transactions')
          .values({
            id,
            account_id: 2,
            platform_key: 'business',
            source_type: 'exchange',
            tx_fingerprint: seedTxFingerprint('business', 2, identityReference),
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            is_spam: false,
            excluded_from_accounting: false,
            created_at: new Date().toISOString(),
          })
          .execute();
      }

      const defaultLinkId = assertOk(await repo.create(makeBtcLink(1, 2)));
      const businessLinkId = assertOk(
        await repo.create({
          ...makeBtcLink(11, 12),
          assetSymbol: 'ETH' as Currency,
        })
      );

      expect(assertOk(await repo.findAll({ profileId: 1 })).map((link) => link.id)).toEqual([defaultLinkId]);
      expect(assertOk(await repo.findAll({ profileId: 2 })).map((link) => link.id)).toEqual([businessLinkId]);
      expect(assertOk(await repo.findById(defaultLinkId, 2))).toBeUndefined();
      expect(assertOk(await repo.findById(businessLinkId, 1))).toBeUndefined();
    });
  });

  describe('updateStatuses', () => {
    it('updates multiple rows in one call', async () => {
      const firstId = assertOk(
        await repo.create({
          ...makeBtcLink(1, 2),
          status: 'suggested',
        })
      );
      const secondId = assertOk(
        await repo.create({
          ...makeBtcLink(3, 4),
          status: 'suggested',
        })
      );

      const updatedRows = assertOk(await repo.updateStatuses([firstId, secondId], 'confirmed', 'cli-user'));
      expect(updatedRows).toBe(2);

      const links = assertOk(await repo.findAll('confirmed'));
      expect(links.map((link) => link.id)).toEqual([firstId, secondId]);
      expect(links.every((link) => link.reviewedBy === 'cli-user')).toBe(true);
    });
  });

  describe('count', () => {
    it('counts all links when no filter is provided', async () => {
      await repo.create(makeBtcLink(1, 2));
      await repo.create({
        ...makeBtcLink(3, 4),
        assetSymbol: 'ETH' as Currency,
      });

      expect(assertOk(await repo.count())).toBe(2);
    });

    it('counts links scoped to specific account IDs', async () => {
      // Add a second account with its own transactions and links
      await db
        .insertInto('accounts')
        .values({
          id: 2,
          profile_id: 1,
          parent_account_id: null,
          account_type: 'exchange-api',
          platform_key: 'test-2',
          identifier: 'test-api-key-2',
          provider_name: null,
          last_cursor: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .execute();

      for (const id of [11, 12]) {
        const identityReference = `test-2-tx-${id}`;
        await db
          .insertInto('transactions')
          .values({
            id,
            account_id: 2,
            platform_key: 'test-2',
            source_type: 'exchange',
            tx_fingerprint: seedTxFingerprint('test-2', 2, identityReference),
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
      });

      expect(assertOk(await repo.count({ accountIds: [1] }))).toBe(1);
      expect(assertOk(await repo.count({ accountIds: [2] }))).toBe(1);
    });

    it('handles large account ID filters when counting', async () => {
      await db
        .insertInto('accounts')
        .values({
          id: 2,
          profile_id: 1,
          parent_account_id: null,
          account_type: 'exchange-api',
          platform_key: 'test-2',
          identifier: 'test-api-key-2',
          provider_name: null,
          last_cursor: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .execute();

      for (const id of [11, 12]) {
        const identityReference = `test-2-tx-${id}`;
        await db
          .insertInto('transactions')
          .values({
            id,
            account_id: 2,
            platform_key: 'test-2',
            source_type: 'exchange',
            tx_fingerprint: seedTxFingerprint('test-2', 2, identityReference),
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            is_spam: false,
            excluded_from_accounting: false,
            created_at: new Date().toISOString(),
          })
          .execute();
      }

      await repo.create(makeBtcLink(1, 2));
      await repo.create({ ...makeBtcLink(11, 12), assetSymbol: 'ETH' as Currency });

      const accountIds = Array.from({ length: 1_200 }, (_, index) => index + 1);
      expect(assertOk(await repo.count({ accountIds }))).toBe(2);
    });

    it('returns 0 when accountIds filter is empty', async () => {
      expect(assertOk(await repo.count({ accountIds: [] }))).toBe(0);
    });

    it('counts links scoped to a profile', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'business',
          display_name: 'business',
          created_at: new Date().toISOString(),
        })
        .execute();
      await seedAccount(db, 2, 'exchange-api', 'business', { profileId: 2 });

      for (const id of [11, 12]) {
        const identityReference = `business-tx-${id}`;
        await db
          .insertInto('transactions')
          .values({
            id,
            account_id: 2,
            platform_key: 'business',
            source_type: 'exchange',
            tx_fingerprint: seedTxFingerprint('business', 2, identityReference),
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
      });

      expect(assertOk(await repo.count({ profileId: 1 }))).toBe(1);
      expect(assertOk(await repo.count({ profileId: 2 }))).toBe(1);
    });
  });
});
