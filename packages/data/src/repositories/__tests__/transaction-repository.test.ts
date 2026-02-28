/* eslint-disable unicorn/no-null -- null needed for db */
import type { UniversalTransactionData } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, unwrapOk } from '../../__tests__/test-utils.js';
import type { KyselyDB } from '../../storage/initialization.js';
import { TransactionRepository } from '../transaction-repository.js';

import { seedAccount, seedImportSession, seedUser } from './helpers.js';

describe('TransactionRepository', () => {
  let db: KyselyDB;
  let repo: TransactionRepository;

  afterEach(async () => {
    await db.destroy();
  });

  describe('deleteAll', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedUser(db);
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedAccount(db, 2, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);
      await seedImportSession(db, 2, 2);

      // 3 kraken + 2 ethereum transactions
      for (let i = 1; i <= 5; i++) {
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: i <= 3 ? 1 : 2,
            source_name: i <= 3 ? 'kraken' : 'ethereum',
            source_type: i <= 3 ? ('exchange' as const) : ('blockchain' as const),
            external_id: `tx-${i}`,
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            is_spam: false,
            excluded_from_accounting: false,
            operation_type: 'deposit',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .execute();
      }
    });

    it('deletes all transactions and returns the count', async () => {
      expect(unwrapOk(await repo.deleteAll())).toBe(5);

      const remaining = await db.selectFrom('transactions').selectAll().execute();
      expect(remaining).toHaveLength(0);
    });

    it('returns 0 when no transactions exist', async () => {
      await db.deleteFrom('transactions').execute();
      expect(unwrapOk(await repo.deleteAll())).toBe(0);
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.deleteAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getTransactions — spam/excluded filtering', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedUser(db);
      await seedAccount(db, 1, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);

      // 3 normal transactions
      for (let i = 1; i <= 3; i++) {
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: 1,
            source_name: 'ethereum',
            source_type: 'blockchain',
            external_id: `tx-${i}`,
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            is_spam: false,
            excluded_from_accounting: false,
            operation_type: 'transfer',
            created_at: new Date().toISOString(),
          })
          .execute();

        await db
          .insertInto('transaction_movements')
          .values({
            transaction_id: i,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'blockchain:ethereum:native',
            asset_symbol: 'ETH',
            gross_amount: '1.0',
            net_amount: '1.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          })
          .execute();
      }

      // 2 scam token transactions (is_spam + excluded_from_accounting)
      for (let i = 4; i <= 5; i++) {
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: 1,
            source_name: 'ethereum',
            source_type: 'blockchain',
            external_id: `scam-tx-${i}`,
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            notes_json: JSON.stringify([{ type: 'SCAM_TOKEN', message: 'Scam token detected', severity: 'error' }]),
            is_spam: true,
            excluded_from_accounting: true,
            operation_type: 'transfer',
            created_at: new Date().toISOString(),
          })
          .execute();

        await db
          .insertInto('transaction_movements')
          .values({
            transaction_id: i,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'blockchain:ethereum:0xscam',
            asset_symbol: 'SCAM',
            gross_amount: '1000.0',
            net_amount: '1000.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          })
          .execute();
      }
    });

    it('excludes spam/excluded transactions by default', async () => {
      const txs = unwrapOk(await repo.getTransactions({ accountId: 1 }));

      expect(txs).toHaveLength(3);
      expect(txs.every((tx) => !tx.notes?.some((n) => n.type === 'SCAM_TOKEN'))).toBe(true);
    });

    it('excludes spam/excluded transactions when includeExcluded is false', async () => {
      const txs = unwrapOk(await repo.getTransactions({ accountId: 1, includeExcluded: false }));
      expect(txs).toHaveLength(3);
    });

    it('includes spam/excluded transactions when includeExcluded is true', async () => {
      const txs = unwrapOk(await repo.getTransactions({ accountId: 1, includeExcluded: true }));

      expect(txs).toHaveLength(5);
      const scamTxs = txs.filter((tx) => tx.notes?.some((n) => n.type === 'SCAM_TOKEN'));
      expect(scamTxs).toHaveLength(2);
    });
  });

  describe('save — isSpam field', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedUser(db);
      await seedAccount(db, 1, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);
    });

    it('persists isSpam=true and auto-excludes from accounting', async () => {
      const tx = {
        datetime: new Date().toISOString(),
        externalId: 'spam-tx-1',
        fees: [],
        isSpam: true,
        movements: {
          inflows: [
            {
              assetId: 'test:scam',
              assetSymbol: 'SCAM' as Currency,
              grossAmount: parseDecimal('1000'),
              netAmount: parseDecimal('1000'),
            },
          ],
          outflows: [],
        },
        note: {
          message: '⚠️ Scam token detected',
          metadata: { scamReason: 'Flagged by provider', scamAsset: 'SCAM' },
          severity: 'error' as const,
          type: 'SCAM_TOKEN',
        },
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        source: 'ethereum',
        sourceType: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      unwrapOk(await repo.save(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('external_id', '=', 'spam-tx-1')
        .executeTakeFirst();
      expect(row?.is_spam).toBe(1);
      expect(row?.excluded_from_accounting).toBe(1);
    });

    it('persists isSpam=false and does not exclude from accounting', async () => {
      const tx = {
        datetime: new Date().toISOString(),
        externalId: 'legit-tx-1',
        fees: [],
        isSpam: false,
        movements: {
          inflows: [
            {
              assetId: 'test:eth',
              assetSymbol: 'ETH' as Currency,
              grossAmount: parseDecimal('1'),
              netAmount: parseDecimal('1'),
            },
          ],
          outflows: [],
        },
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        source: 'ethereum',
        sourceType: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      unwrapOk(await repo.save(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('external_id', '=', 'legit-tx-1')
        .executeTakeFirst();
      expect(row?.is_spam).toBe(0);
      expect(row?.excluded_from_accounting).toBe(0);
    });

    it('defaults isSpam to false when not specified', async () => {
      const tx = {
        datetime: new Date().toISOString(),
        externalId: 'normal-tx-1',
        fees: [],
        movements: {
          inflows: [
            {
              assetId: 'test:eth',
              assetSymbol: 'ETH' as Currency,
              grossAmount: parseDecimal('1'),
              netAmount: parseDecimal('1'),
            },
          ],
          outflows: [],
        },
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        source: 'ethereum',
        sourceType: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      unwrapOk(await repo.save(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('external_id', '=', 'normal-tx-1')
        .executeTakeFirst();
      expect(row?.is_spam).toBe(0);
    });

    it('respects explicit excludedFromAccounting=false even when isSpam=true', async () => {
      const tx = {
        datetime: new Date().toISOString(),
        excludedFromAccounting: false,
        externalId: 'spam-tx-2',
        fees: [],
        isSpam: true,
        movements: { inflows: [], outflows: [] },
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        source: 'ethereum',
        sourceType: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      unwrapOk(await repo.save(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('external_id', '=', 'spam-tx-2')
        .executeTakeFirst();
      expect(row?.is_spam).toBe(1);
      expect(row?.excluded_from_accounting).toBe(0);
    });

    it('auto-excludes when isSpam=true and excludedFromAccounting is not set', async () => {
      const tx = {
        datetime: new Date().toISOString(),
        externalId: 'spam-tx-3',
        fees: [],
        isSpam: true,
        movements: { inflows: [], outflows: [] },
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        source: 'ethereum',
        sourceType: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      unwrapOk(await repo.save(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('external_id', '=', 'spam-tx-3')
        .executeTakeFirst();
      expect(row?.is_spam).toBe(1);
      expect(row?.excluded_from_accounting).toBe(1);
    });
  });

  describe('updateMovementsWithPrices', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedUser(db);
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedImportSession(db, 1, 1);
    });

    it('persists enriched movements and fees with price data', async () => {
      await db
        .insertInto('transactions')
        .values({
          id: 1,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-1',
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'swap',
          is_spam: false,
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values([
          {
            transaction_id: 1,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'blockchain:bitcoin:native',
            asset_symbol: 'BTC',
            gross_amount: '1.0',
            net_amount: '1.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          {
            transaction_id: 1,
            position: 1,
            movement_type: 'fee',
            asset_id: 'blockchain:bitcoin:native',
            asset_symbol: 'BTC',
            gross_amount: null,
            net_amount: null,
            fee_amount: '0.0001',
            fee_scope: 'network',
            fee_settlement: 'on-chain',
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
        ])
        .execute();

      const enriched: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'tx-1',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        source: 'kraken',
        sourceType: 'exchange',
        status: 'success',
        operation: { category: 'trade', type: 'swap' },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
                source: 'coingecko',
                fetchedAt: new Date(),
                granularity: 'hour',
              },
            },
          ],
          outflows: [],
        },
        fees: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.0001'),
            scope: 'network',
            settlement: 'on-chain',
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
              source: 'coingecko',
              fetchedAt: new Date(),
              granularity: 'hour',
            },
          },
        ],
      };

      unwrapOk(await repo.updateMovementsWithPrices(enriched));

      const movements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 1)
        .orderBy('position', 'asc')
        .execute();

      const inflow = movements.find((m) => m.movement_type === 'inflow');
      const fee = movements.find((m) => m.movement_type === 'fee');

      expect(inflow?.price_source).toBe('coingecko');
      expect(inflow?.price_amount).toBe('50000');
      expect(fee?.price_source).toBe('coingecko');
      expect(fee?.price_amount).toBe('50000');
    });

    it('replaces all existing movement rows and preserves position ordering', async () => {
      await db
        .insertInto('transactions')
        .values({
          id: 2,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-2',
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'swap',
          is_spam: false,
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 2,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'legacy:asset',
          asset_symbol: 'OLD',
          gross_amount: '1.0',
          net_amount: '1.0',
          fee_amount: null,
          fee_scope: null,
          fee_settlement: null,
          price_amount: null,
          price_currency: null,
          price_source: null,
          price_fetched_at: null,
          price_granularity: null,
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      const enriched: UniversalTransactionData = {
        id: 2,
        accountId: 1,
        externalId: 'tx-2',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        source: 'kraken',
        sourceType: 'exchange',
        status: 'success',
        operation: { category: 'trade', type: 'swap' },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
                source: 'coingecko',
                fetchedAt: new Date(),
                granularity: 'hour',
              },
            },
          ],
          outflows: [
            {
              assetId: 'test:usdt',
              assetSymbol: 'USDT' as Currency,
              grossAmount: parseDecimal('50000'),
              netAmount: parseDecimal('50000'),
              priceAtTxTime: {
                price: { amount: parseDecimal('1'), currency: 'USD' as Currency },
                source: 'coingecko',
                fetchedAt: new Date(),
                granularity: 'hour',
              },
            },
          ],
        },
        fees: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.0001'),
            scope: 'network',
            settlement: 'on-chain',
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
              source: 'coingecko',
              fetchedAt: new Date(),
              granularity: 'hour',
            },
          },
        ],
      };

      unwrapOk(await repo.updateMovementsWithPrices(enriched));

      const movements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 2)
        .orderBy('position', 'asc')
        .execute();

      expect(movements).toHaveLength(3);
      expect(movements.map((m) => m.position)).toEqual([0, 1, 2]);
      expect(movements.map((m) => m.movement_type)).toEqual(['inflow', 'outflow', 'fee']);
      expect(movements.some((m) => m.asset_id === 'legacy:asset')).toBe(false);
    });

    it('rejects invalid movement price metadata and leaves rows unchanged', async () => {
      await db
        .insertInto('transactions')
        .values({
          id: 3,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-3',
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'swap',
          is_spam: false,
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 3,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'test:btc',
          asset_symbol: 'BTC',
          gross_amount: '1.0',
          net_amount: '1.0',
          fee_amount: null,
          fee_scope: null,
          fee_settlement: null,
          price_amount: null,
          price_currency: null,
          price_source: null,
          price_fetched_at: null,
          price_granularity: null,
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      const enriched: UniversalTransactionData = {
        id: 3,
        accountId: 1,
        externalId: 'tx-3',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        source: 'kraken',
        sourceType: 'exchange',
        status: 'success',
        operation: { category: 'trade', type: 'swap' },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
                source: 'coingecko',
                fetchedAt: new Date(),
                granularity: 'invalid-granularity' as unknown as 'hour',
              },
            },
          ],
          outflows: [],
        },
        fees: [],
      };

      const result = await repo.updateMovementsWithPrices(enriched);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid inflow movement data');
      }

      const movements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 3)
        .execute();
      expect(movements).toHaveLength(1);
      expect(movements[0]?.price_source).toBeNull();
    });

    it('cascades movement deletion when the transaction is deleted', async () => {
      await db
        .insertInto('transactions')
        .values({
          id: 4,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-4',
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'deposit',
          is_spam: false,
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 4,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'test:eth',
          asset_symbol: 'ETH',
          gross_amount: '2.0',
          net_amount: '2.0',
          fee_amount: null,
          fee_scope: null,
          fee_settlement: null,
          price_amount: null,
          price_currency: null,
          price_source: null,
          price_fetched_at: null,
          price_granularity: null,
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      await db.deleteFrom('transactions').where('id', '=', 4).execute();

      const remaining = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 4)
        .execute();
      expect(remaining).toHaveLength(0);
    });

    it('returns an error when the transaction ID does not exist', async () => {
      const enriched: UniversalTransactionData = {
        id: 999,
        accountId: 1,
        externalId: 'tx-999',
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        source: 'kraken',
        sourceType: 'exchange',
        status: 'success',
        operation: { category: 'trade', type: 'swap' },
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
                source: 'coingecko',
                fetchedAt: new Date(),
                granularity: 'hour',
              },
            },
          ],
          outflows: [],
        },
        fees: [],
      };

      const result = await repo.updateMovementsWithPrices(enriched);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Transaction 999 not found');
      }
    });
  });
});
