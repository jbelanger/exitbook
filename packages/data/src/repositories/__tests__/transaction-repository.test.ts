/* eslint-disable unicorn/no-null -- null needed for db */
import type { Transaction, TransactionDraft } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { TransactionRepository } from '../transaction-repository.js';

import { seedAccount, seedImportSession, seedMovementFingerprint, seedTxFingerprint, seedUser } from './helpers.js';

describe('TransactionRepository', () => {
  let db: KyselyDB;
  let repo: TransactionRepository;

  function makePersistedTransaction(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
    const source = overrides.source ?? 'ethereum';
    const sourceType = overrides.sourceType ?? 'blockchain';
    const externalId = overrides.externalId ?? 'tx-default';

    return {
      datetime: '2025-01-01T00:00:00.000Z',
      externalId,
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
      operation: { category: 'transfer', type: 'deposit' },
      source,
      sourceType,
      status: 'success',
      timestamp: 1_735_689_600_000,
      blockchain:
        sourceType === 'blockchain'
          ? {
              name: source,
              transaction_hash: externalId,
              is_confirmed: true,
            }
          : undefined,
      ...overrides,
    };
  }

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
        const accountId = i <= 3 ? 1 : 2;
        const sourceName = i <= 3 ? 'kraken' : 'ethereum';
        const externalId = `tx-${i}`;
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: accountId,
            source_name: sourceName,
            source_type: i <= 3 ? ('exchange' as const) : ('blockchain' as const),
            tx_fingerprint: seedTxFingerprint(sourceName, accountId, externalId),
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
      expect(assertOk(await repo.deleteAll())).toBe(5);

      const remaining = await db.selectFrom('transactions').selectAll().execute();
      expect(remaining).toHaveLength(0);
    });

    it('returns 0 when no transactions exist', async () => {
      await db.deleteFrom('transactions').execute();
      expect(assertOk(await repo.deleteAll())).toBe(0);
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

  describe('findAll — spam/excluded filtering', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedUser(db);
      await seedAccount(db, 1, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);

      // 3 normal transactions
      for (let i = 1; i <= 3; i++) {
        const externalId = `tx-${i}`;
        const txFingerprint = seedTxFingerprint('ethereum', 1, externalId);
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: 1,
            source_name: 'ethereum',
            source_type: 'blockchain',
            tx_fingerprint: txFingerprint,
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
            movement_fingerprint: seedMovementFingerprint(txFingerprint, 'inflow', 0),
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

      // 2 scam token transactions (is_spam persisted, excluded_from_accounting true for filter coverage)
      for (let i = 4; i <= 5; i++) {
        const externalId = `scam-tx-${i}`;
        const txFingerprint = seedTxFingerprint('ethereum', 1, externalId);
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: 1,
            source_name: 'ethereum',
            source_type: 'blockchain',
            tx_fingerprint: txFingerprint,
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
            movement_fingerprint: seedMovementFingerprint(txFingerprint, 'inflow', 0),
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
      const txs = assertOk(await repo.findAll({ accountId: 1 }));

      expect(txs).toHaveLength(3);
      expect(txs.every((tx) => !tx.notes?.some((n) => n.type === 'SCAM_TOKEN'))).toBe(true);
      expect(txs[0]?.txFingerprint).toBe(seedTxFingerprint('ethereum', 1, 'tx-1'));
      expect(txs[0]?.movements.inflows?.[0]?.movementFingerprint).toBe(
        seedMovementFingerprint(seedTxFingerprint('ethereum', 1, 'tx-1'), 'inflow', 0)
      );
    });

    it('excludes spam/excluded transactions when includeExcluded is false', async () => {
      const txs = assertOk(await repo.findAll({ accountId: 1, includeExcluded: false }));
      expect(txs).toHaveLength(3);
    });

    it('includes spam/excluded transactions when includeExcluded is true', async () => {
      const txs = assertOk(await repo.findAll({ accountId: 1, includeExcluded: true }));

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

    it('persists isSpam=true without auto-excluding from accounting', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'spam-tx-1',
        },
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

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'spam-tx-1'))
        .executeTakeFirst();
      const movementRow = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', row!.id)
        .executeTakeFirst();
      expect(row?.is_spam).toBe(1);
      expect(row?.excluded_from_accounting).toBe(0);
      expect(row?.tx_fingerprint).toBe(seedTxFingerprint('ethereum', 1, 'spam-tx-1'));
      expect(movementRow?.movement_fingerprint).toBe(
        seedMovementFingerprint(seedTxFingerprint('ethereum', 1, 'spam-tx-1'), 'inflow', 0)
      );
    });

    it('persists isSpam=false and does not exclude from accounting', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'legit-tx-1',
        },
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

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'legit-tx-1'))
        .executeTakeFirst();
      expect(row?.is_spam).toBe(0);
      expect(row?.excluded_from_accounting).toBe(0);
    });

    it('defaults isSpam to false when not specified', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'normal-tx-1',
        },
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

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'normal-tx-1'))
        .executeTakeFirst();
      expect(row?.is_spam).toBe(0);
    });

    it('respects explicit excludedFromAccounting=false even when isSpam=true', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'spam-tx-2',
        },
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

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'spam-tx-2'))
        .executeTakeFirst();
      expect(row?.is_spam).toBe(1);
      expect(row?.excluded_from_accounting).toBe(0);
    });

    it('does not auto-exclude when isSpam=true and excludedFromAccounting is not set', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'spam-tx-3',
        },
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

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'spam-tx-3'))
        .executeTakeFirst();
      expect(row?.is_spam).toBe(1);
      expect(row?.excluded_from_accounting).toBe(0);
    });
  });

  describe('create/createBatch identity deduplication', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedUser(db);
      await seedAccount(db, 1, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);
    });

    it('returns the existing row id when the tx fingerprint already exists', async () => {
      const transaction = makePersistedTransaction({ externalId: 'dup-tx-1' });

      const firstId = assertOk(await repo.create(transaction, 1));
      const secondId = assertOk(await repo.create(transaction, 1));

      expect(secondId).toBe(firstId);

      const transactions = await db.selectFrom('transactions').select(['id']).execute();
      const movements = await db.selectFrom('transaction_movements').select(['id']).execute();

      expect(transactions).toHaveLength(1);
      expect(movements).toHaveLength(1);
    });

    it('counts tx fingerprint duplicates in createBatch without creating extra rows', async () => {
      const transaction = makePersistedTransaction({ externalId: 'dup-batch-1' });

      const result = assertOk(await repo.createBatch([transaction, transaction], 1));

      expect(result.duplicates).toBe(1);

      const transactions = await db.selectFrom('transactions').select(['id']).execute();
      const movements = await db.selectFrom('transaction_movements').select(['id']).execute();

      expect(transactions).toHaveLength(1);
      expect(movements).toHaveLength(1);
    });

    it('deduplicates when the same blockchain hash arrives with a different externalId', async () => {
      const firstId = assertOk(
        await repo.create(
          makePersistedTransaction({
            blockchain: {
              name: 'ethereum',
              transaction_hash: '0xabc123',
              is_confirmed: true,
            },
            externalId: 'hash-source-1',
          }),
          1
        )
      );

      const secondId = assertOk(
        await repo.create(
          makePersistedTransaction({
            blockchain: {
              name: 'ethereum',
              transaction_hash: '0xabc123',
              is_confirmed: true,
            },
            externalId: 'hash-source-2',
          }),
          1
        )
      );

      expect(secondId).toBe(firstId);
      const transactions = await db.selectFrom('transactions').select(['id']).execute();
      expect(transactions).toHaveLength(1);
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
      const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-1');
      await db
        .insertInto('transactions')
        .values({
          id: 1,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          tx_fingerprint: txFingerprint,
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
            movement_fingerprint: seedMovementFingerprint(txFingerprint, 'inflow', 0),
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
            movement_fingerprint: seedMovementFingerprint(txFingerprint, 'fee', 0),
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

      const enriched: Transaction = {
        id: 1,
        accountId: 1,
        externalId: 'tx-1',
        txFingerprint,
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

      assertOk(await repo.updateMovementsWithPrices(enriched));

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
      expect(inflow?.movement_fingerprint).toBe(seedMovementFingerprint(txFingerprint, 'inflow', 0));
      expect(fee?.price_source).toBe('coingecko');
      expect(fee?.price_amount).toBe('50000');
      expect(fee?.movement_fingerprint).toBe(seedMovementFingerprint(txFingerprint, 'fee', 0));
    });

    it('replaces all existing movement rows and preserves position ordering', async () => {
      const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-2');
      await db
        .insertInto('transactions')
        .values({
          id: 2,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          tx_fingerprint: txFingerprint,
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
          movement_fingerprint: seedMovementFingerprint(txFingerprint, 'inflow', 0),
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

      const enriched: Transaction = {
        id: 2,
        accountId: 1,
        externalId: 'tx-2',
        txFingerprint,
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

      assertOk(await repo.updateMovementsWithPrices(enriched));

      const movements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 2)
        .orderBy('position', 'asc')
        .execute();

      expect(movements).toHaveLength(3);
      expect(movements.map((m) => m.position)).toEqual([0, 1, 2]);
      expect(movements.map((m) => m.movement_type)).toEqual(['inflow', 'outflow', 'fee']);
      expect(movements.map((m) => m.movement_fingerprint)).toEqual([
        seedMovementFingerprint(txFingerprint, 'inflow', 0),
        seedMovementFingerprint(txFingerprint, 'outflow', 0),
        seedMovementFingerprint(txFingerprint, 'fee', 0),
      ]);
      expect(movements.some((m) => m.asset_id === 'legacy:asset')).toBe(false);
    });

    it('rejects invalid movement price metadata and leaves rows unchanged', async () => {
      const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-3');
      await db
        .insertInto('transactions')
        .values({
          id: 3,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          tx_fingerprint: txFingerprint,
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
          movement_fingerprint: seedMovementFingerprint(txFingerprint, 'inflow', 0),
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

      const enriched: Transaction = {
        id: 3,
        accountId: 1,
        externalId: 'tx-3',
        txFingerprint,
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
      const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-4');
      await db
        .insertInto('transactions')
        .values({
          id: 4,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          tx_fingerprint: txFingerprint,
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
          movement_fingerprint: seedMovementFingerprint(txFingerprint, 'inflow', 0),
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
      const enriched: Transaction = {
        id: 999,
        accountId: 1,
        externalId: 'tx-999',
        txFingerprint: seedTxFingerprint('kraken', 1, 'tx-999'),
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

  describe('materializeTransactionNoteOverrides', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedUser(db);
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedAccount(db, 2, 'exchange-api', 'coinbase');
      await seedImportSession(db, 1, 1);
      await seedImportSession(db, 2, 2);
    });

    it('appends a materialized user note while preserving existing non-override notes', async () => {
      await db
        .insertInto('transactions')
        .values({
          id: 11,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          tx_fingerprint: seedTxFingerprint('kraken', 1, 'tx-11'),
          transaction_status: 'success',
          transaction_datetime: '2025-01-01T00:00:00.000Z',
          notes_json: JSON.stringify([
            {
              type: 'system_flag',
              message: 'Imported from CSV',
            },
          ]),
          is_spam: false,
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      const fingerprint = seedTxFingerprint('kraken', 1, 'tx-11');

      const updated = assertOk(
        await repo.materializeTransactionNoteOverrides({
          accountIds: [1],
          notesByFingerprint: new Map([[fingerprint, 'Moved to cold storage']]),
        })
      );

      expect(updated).toBe(1);

      const row = await db
        .selectFrom('transactions')
        .select(['notes_json'])
        .where('id', '=', 11)
        .executeTakeFirstOrThrow();
      expect(JSON.parse((row.notes_json as string | null) ?? '[]')).toEqual([
        {
          type: 'system_flag',
          message: 'Imported from CSV',
        },
        {
          type: 'user_note',
          message: 'Moved to cold storage',
          metadata: {
            actor: 'user',
            source: 'override-store',
          },
        },
      ]);
    });

    it('replaces stale materialized user notes and clears them when no override remains', async () => {
      await db
        .insertInto('transactions')
        .values([
          {
            id: 21,
            account_id: 1,
            source_name: 'kraken',
            source_type: 'exchange',
            tx_fingerprint: seedTxFingerprint('kraken', 1, 'tx-21'),
            transaction_status: 'success',
            transaction_datetime: '2025-01-02T00:00:00.000Z',
            notes_json: JSON.stringify([
              {
                type: 'user_note',
                message: 'Old note',
                metadata: {
                  actor: 'user',
                  source: 'override-store',
                },
              },
            ]),
            is_spam: false,
            excluded_from_accounting: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 22,
            account_id: 2,
            source_name: 'coinbase',
            source_type: 'exchange',
            tx_fingerprint: seedTxFingerprint('coinbase', 2, 'tx-22'),
            transaction_status: 'success',
            transaction_datetime: '2025-01-03T00:00:00.000Z',
            notes_json: JSON.stringify([
              {
                type: 'user_note',
                message: 'Remove me',
                metadata: {
                  actor: 'user',
                  source: 'override-store',
                },
              },
            ]),
            is_spam: false,
            excluded_from_accounting: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .execute();

      const fingerprint = seedTxFingerprint('kraken', 1, 'tx-21');

      const updated = assertOk(
        await repo.materializeTransactionNoteOverrides({
          transactionIds: [21, 22],
          notesByFingerprint: new Map([[fingerprint, 'Updated note']]),
        })
      );

      expect(updated).toBe(2);

      const rows = await db
        .selectFrom('transactions')
        .select(['id', 'notes_json'])
        .where('id', 'in', [21, 22])
        .orderBy('id', 'asc')
        .execute();

      expect(JSON.parse((rows[0]?.notes_json as string | null) ?? '[]')).toEqual([
        {
          type: 'user_note',
          message: 'Updated note',
          metadata: {
            actor: 'user',
            source: 'override-store',
          },
        },
      ]);
      expect(rows[1]?.notes_json).toBeNull();
    });

    it('returns zero when scoping is explicitly empty', async () => {
      const updated = assertOk(
        await repo.materializeTransactionNoteOverrides({
          accountIds: [],
          notesByFingerprint: new Map(),
        })
      );

      expect(updated).toBe(0);
    });
  });
});
