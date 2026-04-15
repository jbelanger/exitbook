/* eslint-disable unicorn/no-null -- null needed for db */
import { AmbiguousTransactionFingerprintRefError, type Transaction, type TransactionDraft } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { TransactionRepository } from '../transaction-repository.js';

import {
  seedAccount,
  seedAssetMovementFingerprint,
  seedFeeMovementFingerprint,
  seedImportSession,
  seedTxFingerprint,
  seedProfile,
} from './helpers.js';

describe('TransactionRepository', () => {
  let db: KyselyDB;
  let repo: TransactionRepository;

  function makePersistedTransaction(
    overrides: Partial<TransactionDraft> & { identityReference?: string | undefined } = {}
  ): TransactionDraft {
    const {
      identityReference: overrideIdentityReference,
      platformKind: overrideSourceType,
      identityMaterial: overrideIdentityMaterial,
      blockchain: overrideBlockchain,
      ...rest
    } = overrides;

    const source = rest.platformKey ?? 'ethereum';
    const platformKind = overrideSourceType ?? 'blockchain';
    const identityReference = overrideIdentityReference ?? overrideBlockchain?.transaction_hash ?? 'tx-default';

    if (platformKind === 'exchange') {
      return {
        datetime: '2025-01-01T00:00:00.000Z',
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
        platformKey: source,
        platformKind: 'exchange',
        status: 'success',
        timestamp: 1_735_689_600_000,
        identityMaterial: overrideIdentityMaterial ?? {
          componentEventIds: [identityReference],
        },
        ...rest,
        blockchain: undefined,
      };
    }

    return {
      datetime: '2025-01-01T00:00:00.000Z',
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
      platformKey: source,
      platformKind: 'blockchain',
      status: 'success',
      timestamp: 1_735_689_600_000,
      ...rest,
      blockchain: overrideBlockchain ?? {
        name: source,
        transaction_hash: identityReference,
        is_confirmed: true,
      },
    };
  }

  function materializeRepositoryTransaction(
    transaction: Omit<Transaction, 'movements' | 'fees'> & {
      fees: TransactionDraft['fees'];
      movements: TransactionDraft['movements'];
    }
  ): Transaction {
    return {
      ...transaction,
      movements: {
        inflows: (transaction.movements.inflows ?? []).map((movement) => ({
          ...movement,
          movementFingerprint:
            'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
              ? movement.movementFingerprint
              : seedAssetMovementFingerprint(transaction.txFingerprint, 'inflow', movement),
        })),
        outflows: (transaction.movements.outflows ?? []).map((movement) => ({
          ...movement,
          movementFingerprint:
            'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
              ? movement.movementFingerprint
              : seedAssetMovementFingerprint(transaction.txFingerprint, 'outflow', movement),
        })),
      },
      fees: (transaction.fees ?? []).map((fee) => ({
        ...fee,
        movementFingerprint:
          'movementFingerprint' in fee && typeof fee.movementFingerprint === 'string'
            ? fee.movementFingerprint
            : seedFeeMovementFingerprint(transaction.txFingerprint, fee),
      })),
    };
  }

  afterEach(async () => {
    await db.destroy();
  });

  describe('deleteAll', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedAccount(db, 2, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);
      await seedImportSession(db, 2, 2);

      // 3 kraken + 2 ethereum transactions
      for (let i = 1; i <= 5; i++) {
        const accountId = i <= 3 ? 1 : 2;
        const platformKey = i <= 3 ? 'kraken' : 'ethereum';
        const identityReference = `tx-${i}`;
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: accountId,
            platform_key: platformKey,
            platform_kind: i <= 3 ? ('exchange' as const) : ('blockchain' as const),
            tx_fingerprint: seedTxFingerprint(platformKey, accountId, identityReference),
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
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

      await seedProfile(db);
      await seedAccount(db, 1, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);

      // 3 normal transactions
      for (let i = 1; i <= 3; i++) {
        const identityReference = `tx-${i}`;
        const txFingerprint = seedTxFingerprint('ethereum', 1, identityReference);
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: 1,
            platform_key: 'ethereum',
            platform_kind: 'blockchain',
            tx_fingerprint: txFingerprint,
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            excluded_from_accounting: false,
            operation_type: 'transfer',
            created_at: new Date().toISOString(),
          })
          .execute();

        await db
          .insertInto('transaction_movements')
          .values({
            transaction_id: i,
            movement_type: 'inflow',
            movement_fingerprint: seedAssetMovementFingerprint(txFingerprint, 'inflow', {
              assetId: 'blockchain:ethereum:native',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
            }),
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

      // 2 scam token transactions (diagnostics persisted, excluded_from_accounting true for filter coverage)
      for (let i = 4; i <= 5; i++) {
        const identityReference = `scam-tx-${i}`;
        const txFingerprint = seedTxFingerprint('ethereum', 1, identityReference);
        await db
          .insertInto('transactions')
          .values({
            id: i,
            account_id: 1,
            platform_key: 'ethereum',
            platform_kind: 'blockchain',
            tx_fingerprint: txFingerprint,
            transaction_status: 'success',
            transaction_datetime: new Date().toISOString(),
            diagnostics_json: JSON.stringify([
              { code: 'SCAM_TOKEN', message: 'Scam token detected', severity: 'error' },
            ]),
            excluded_from_accounting: true,
            operation_type: 'transfer',
            created_at: new Date().toISOString(),
          })
          .execute();

        await db
          .insertInto('transaction_movements')
          .values({
            transaction_id: i,
            movement_type: 'inflow',
            movement_fingerprint: seedAssetMovementFingerprint(txFingerprint, 'inflow', {
              assetId: 'blockchain:ethereum:0xscam',
              grossAmount: parseDecimal('1000.0'),
              netAmount: parseDecimal('1000.0'),
            }),
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
      expect(txs.every((tx) => !tx.diagnostics?.some((diagnostic) => diagnostic.code === 'SCAM_TOKEN'))).toBe(true);
      expect(txs[0]?.txFingerprint).toBe(seedTxFingerprint('ethereum', 1, 'tx-1'));
      expect(txs[0]?.movements.inflows?.[0]?.movementFingerprint).toBe(
        seedAssetMovementFingerprint(seedTxFingerprint('ethereum', 1, 'tx-1'), 'inflow', {
          assetId: 'blockchain:ethereum:native',
          grossAmount: parseDecimal('1.0'),
          netAmount: parseDecimal('1.0'),
        })
      );
    });

    it('excludes spam/excluded transactions when includeExcluded is false', async () => {
      const txs = assertOk(await repo.findAll({ accountId: 1, includeExcluded: false }));
      expect(txs).toHaveLength(3);
    });

    it('includes spam/excluded transactions when includeExcluded is true', async () => {
      const txs = assertOk(await repo.findAll({ accountId: 1, includeExcluded: true }));

      expect(txs).toHaveLength(5);
      const scamTxs = txs.filter((tx) => tx.diagnostics?.some((diagnostic) => diagnostic.code === 'SCAM_TOKEN'));
      expect(scamTxs).toHaveLength(2);
    });
  });

  describe('save — diagnostics persistence', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
      await seedAccount(db, 1, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);
    });

    it('persists SCAM_TOKEN diagnostics without auto-excluding from accounting', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'spam-tx-1',
        },
        datetime: new Date().toISOString(),
        fees: [],
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
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
            message: 'Scam token detected',
            metadata: { scamReason: 'Flagged by provider', scamAsset: 'SCAM' },
            severity: 'error' as const,
          },
        ],
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        platformKey: 'ethereum',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'spam-tx-1'))
        .executeTakeFirst();
      expect(row?.diagnostics_json).toContain('SCAM_TOKEN');
      const movementRow = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', row!.id)
        .executeTakeFirst();
      expect(row?.excluded_from_accounting).toBe(0);
      expect(row?.tx_fingerprint).toBe(seedTxFingerprint('ethereum', 1, 'spam-tx-1'));
      expect(movementRow?.movement_fingerprint).toBe(
        seedAssetMovementFingerprint(seedTxFingerprint('ethereum', 1, 'spam-tx-1'), 'inflow', {
          assetId: 'test:scam',
          grossAmount: parseDecimal('1000'),
          netAmount: parseDecimal('1000'),
        })
      );
    });

    it('persists transactions without diagnostics and does not exclude from accounting', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'legit-tx-1',
        },
        datetime: new Date().toISOString(),
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
        platformKey: 'ethereum',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'legit-tx-1'))
        .executeTakeFirst();
      expect(row?.diagnostics_json).toBeNull();
      expect(row?.excluded_from_accounting).toBe(0);
    });

    it('defaults diagnostics_json to null when not specified', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'normal-tx-1',
        },
        datetime: new Date().toISOString(),
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
        platformKey: 'ethereum',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'normal-tx-1'))
        .executeTakeFirst();
      expect(row?.diagnostics_json).toBeNull();
    });

    it('respects explicit excludedFromAccounting=false even when diagnostics mark the transaction as scam', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'spam-tx-2',
        },
        datetime: new Date().toISOString(),
        excludedFromAccounting: false,
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
            message: 'Scam token detected',
            severity: 'error' as const,
          },
        ],
        fees: [],
        movements: { inflows: [], outflows: [] },
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        platformKey: 'ethereum',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'spam-tx-2'))
        .executeTakeFirst();
      expect(row?.diagnostics_json).toContain('SCAM_TOKEN');
      expect(row?.excluded_from_accounting).toBe(0);
    });

    it('does not auto-exclude when scam diagnostics are present and excludedFromAccounting is not set', async () => {
      const tx = {
        blockchain: {
          is_confirmed: true,
          name: 'ethereum',
          transaction_hash: 'spam-tx-3',
        },
        datetime: new Date().toISOString(),
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
            message: 'Scam token detected',
            severity: 'error' as const,
          },
        ],
        fees: [],
        movements: { inflows: [], outflows: [] },
        operation: { category: 'transfer' as const, type: 'deposit' as const },
        platformKey: 'ethereum',
        platformKind: 'blockchain' as const,
        status: 'success' as const,
        timestamp: Date.now(),
      };

      assertOk(await repo.create(tx, 1));

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('tx_fingerprint', '=', seedTxFingerprint('ethereum', 1, 'spam-tx-3'))
        .executeTakeFirst();
      expect(row?.diagnostics_json).toContain('SCAM_TOKEN');
      expect(row?.excluded_from_accounting).toBe(0);
    });
  });

  describe('create/createBatch identity deduplication', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
      await seedAccount(db, 1, 'blockchain', 'ethereum');
      await seedImportSession(db, 1, 1);
    });

    it('returns the existing row id when the tx fingerprint already exists', async () => {
      const transaction = makePersistedTransaction({ identityReference: 'dup-tx-1' });

      const firstId = assertOk(await repo.create(transaction, 1));
      const secondId = assertOk(await repo.create(transaction, 1));

      expect(secondId).toBe(firstId);

      const transactions = await db.selectFrom('transactions').select(['id']).execute();
      const movements = await db.selectFrom('transaction_movements').select(['id']).execute();

      expect(transactions).toHaveLength(1);
      expect(movements).toHaveLength(1);
    });

    it('counts tx fingerprint duplicates in createBatch without creating extra rows', async () => {
      const transaction = makePersistedTransaction({ identityReference: 'dup-batch-1' });

      const result = assertOk(await repo.createBatch([transaction, transaction], 1));

      expect(result.duplicates).toBe(1);

      const transactions = await db.selectFrom('transactions').select(['id']).execute();
      const movements = await db.selectFrom('transaction_movements').select(['id']).execute();

      expect(transactions).toHaveLength(1);
      expect(movements).toHaveLength(1);
    });

    it('deduplicates when the same blockchain hash arrives with a different identity reference', async () => {
      const firstId = assertOk(
        await repo.create(
          makePersistedTransaction({
            blockchain: {
              name: 'ethereum',
              transaction_hash: '0xabc123',
              is_confirmed: true,
            },
            identityReference: 'hash-source-1',
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
            identityReference: 'hash-source-2',
          }),
          1
        )
      );

      expect(secondId).toBe(firstId);
      const transactions = await db.selectFrom('transactions').select(['id']).execute();
      expect(transactions).toHaveLength(1);
    });

    it('treats the same exchange event IDs in different profiles as distinct transactions', async () => {
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'secondary',
          display_name: 'secondary',
          created_at: new Date().toISOString(),
        })
        .execute();
      await seedAccount(db, 2, 'exchange-api', 'kraken', { profileId: 2 });
      await seedImportSession(db, 2, 2);

      const transaction = makePersistedTransaction({
        platformKey: 'kraken',
        platformKind: 'exchange',
        identityReference: 'shared-fill-1',
      });

      const firstId = assertOk(await repo.create(transaction, 1));
      const secondId = assertOk(await repo.create(transaction, 2));

      expect(secondId).not.toBe(firstId);

      const transactions = await db.selectFrom('transactions').select(['id']).orderBy('id', 'asc').execute();
      expect(transactions).toHaveLength(2);
    });
  });

  describe('updateMovementsWithPrices', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
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
          platform_key: 'kraken',
          platform_kind: 'exchange',
          tx_fingerprint: txFingerprint,
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'swap',
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
            movement_type: 'inflow',
            movement_fingerprint: seedAssetMovementFingerprint(txFingerprint, 'inflow', {
              assetId: 'blockchain:bitcoin:native',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
            }),
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
            movement_type: 'fee',
            movement_fingerprint: seedFeeMovementFingerprint(txFingerprint, {
              assetId: 'blockchain:bitcoin:native',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
            }),
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

      const enriched = materializeRepositoryTransaction({
        id: 1,
        accountId: 1,
        txFingerprint,
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'kraken',
        platformKind: 'exchange',
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
      });

      assertOk(await repo.updateMovementsWithPrices(enriched));

      const movements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 1)
        .execute();

      const inflow = movements.find((m) => m.movement_type === 'inflow');
      const fee = movements.find((m) => m.movement_type === 'fee');

      expect(inflow?.price_source).toBe('coingecko');
      expect(inflow?.price_amount).toBe('50000');
      expect(inflow?.movement_fingerprint).toBe(
        seedAssetMovementFingerprint(txFingerprint, 'inflow', {
          assetId: 'test:btc',
          grossAmount: parseDecimal('1.0'),
          netAmount: parseDecimal('1.0'),
        })
      );
      expect(fee?.price_source).toBe('coingecko');
      expect(fee?.price_amount).toBe('50000');
      expect(fee?.movement_fingerprint).toBe(
        seedFeeMovementFingerprint(txFingerprint, {
          assetId: 'test:btc',
          amount: parseDecimal('0.0001'),
          scope: 'network',
          settlement: 'on-chain',
        })
      );
    });

    it('replaces all existing movement rows and persists canonical movement fingerprints', async () => {
      const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-2');
      await db
        .insertInto('transactions')
        .values({
          id: 2,
          account_id: 1,
          platform_key: 'kraken',
          platform_kind: 'exchange',
          tx_fingerprint: txFingerprint,
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'swap',
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 2,
          movement_type: 'inflow',
          movement_fingerprint: seedAssetMovementFingerprint(txFingerprint, 'inflow', {
            assetId: 'legacy:asset',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
          }),
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

      const enriched = materializeRepositoryTransaction({
        id: 2,
        accountId: 1,
        txFingerprint,
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'kraken',
        platformKind: 'exchange',
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
      });

      assertOk(await repo.updateMovementsWithPrices(enriched));

      const movements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 2)
        .execute();

      expect(movements).toHaveLength(3);
      expect(movements.map((m) => m.movement_type)).toEqual(['inflow', 'outflow', 'fee']);
      expect(movements.map((m) => m.movement_fingerprint)).toEqual([
        seedAssetMovementFingerprint(txFingerprint, 'inflow', {
          assetId: 'test:btc',
          grossAmount: parseDecimal('1.0'),
          netAmount: parseDecimal('1.0'),
        }),
        seedAssetMovementFingerprint(txFingerprint, 'outflow', {
          assetId: 'test:usdt',
          grossAmount: parseDecimal('50000'),
          netAmount: parseDecimal('50000'),
        }),
        seedFeeMovementFingerprint(txFingerprint, {
          assetId: 'test:btc',
          amount: parseDecimal('0.0001'),
          scope: 'network',
          settlement: 'on-chain',
        }),
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
          platform_key: 'kraken',
          platform_kind: 'exchange',
          tx_fingerprint: txFingerprint,
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'swap',
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 3,
          movement_type: 'inflow',
          movement_fingerprint: seedAssetMovementFingerprint(txFingerprint, 'inflow', {
            assetId: 'test:btc',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
          }),
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

      const enriched = materializeRepositoryTransaction({
        id: 3,
        accountId: 1,
        txFingerprint,
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'kraken',
        platformKind: 'exchange',
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
      });

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
          platform_key: 'kraken',
          platform_kind: 'exchange',
          tx_fingerprint: txFingerprint,
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          operation_type: 'deposit',
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 4,
          movement_type: 'inflow',
          movement_fingerprint: seedAssetMovementFingerprint(txFingerprint, 'inflow', {
            assetId: 'test:eth',
            grossAmount: parseDecimal('2.0'),
            netAmount: parseDecimal('2.0'),
          }),
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
      const enriched = materializeRepositoryTransaction({
        id: 999,
        accountId: 1,
        txFingerprint: seedTxFingerprint('kraken', 1, 'tx-999'),
        datetime: new Date().toISOString(),
        timestamp: Date.now(),
        platformKey: 'kraken',
        platformKind: 'exchange',
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
      });

      const result = await repo.updateMovementsWithPrices(enriched);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Transaction 999 not found');
      }
    });
  });

  describe('materializeTransactionUserNoteOverrides', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedAccount(db, 2, 'exchange-api', 'coinbase');
      await seedImportSession(db, 1, 1);
      await seedImportSession(db, 2, 2);
    });

    it('appends a materialized user note while preserving existing diagnostics', async () => {
      await db
        .insertInto('transactions')
        .values({
          id: 11,
          account_id: 1,
          platform_key: 'kraken',
          platform_kind: 'exchange',
          tx_fingerprint: seedTxFingerprint('kraken', 1, 'tx-11'),
          transaction_status: 'success',
          transaction_datetime: '2025-01-01T00:00:00.000Z',
          diagnostics_json: JSON.stringify([
            {
              code: 'system_flag',
              message: 'Imported from CSV',
            },
          ]),
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      const fingerprint = seedTxFingerprint('kraken', 1, 'tx-11');

      const updated = assertOk(
        await repo.materializeTransactionUserNoteOverrides({
          accountIds: [1],
          userNoteByFingerprint: new Map([
            [
              fingerprint,
              {
                message: 'Moved to cold storage',
                createdAt: '2026-03-15T12:00:00.000Z',
                author: 'user',
              },
            ],
          ]),
        })
      );

      expect(updated).toBe(1);

      const row = await db
        .selectFrom('transactions')
        .select(['diagnostics_json', 'user_notes_json'])
        .where('id', '=', 11)
        .executeTakeFirstOrThrow();
      expect(JSON.parse((row.diagnostics_json as string | null) ?? '[]')).toEqual([
        {
          code: 'system_flag',
          message: 'Imported from CSV',
        },
      ]);
      expect(JSON.parse((row.user_notes_json as string | null) ?? '[]')).toEqual([
        {
          message: 'Moved to cold storage',
          createdAt: '2026-03-15T12:00:00.000Z',
          author: 'user',
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
            platform_key: 'kraken',
            platform_kind: 'exchange',
            tx_fingerprint: seedTxFingerprint('kraken', 1, 'tx-21'),
            transaction_status: 'success',
            transaction_datetime: '2025-01-02T00:00:00.000Z',
            user_notes_json: JSON.stringify([
              {
                message: 'Old note',
                createdAt: '2026-03-01T00:00:00.000Z',
                author: 'user',
              },
            ]),
            excluded_from_accounting: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 22,
            account_id: 2,
            platform_key: 'coinbase',
            platform_kind: 'exchange',
            tx_fingerprint: seedTxFingerprint('coinbase', 2, 'tx-22'),
            transaction_status: 'success',
            transaction_datetime: '2025-01-03T00:00:00.000Z',
            user_notes_json: JSON.stringify([
              {
                message: 'Remove me',
                createdAt: '2026-03-02T00:00:00.000Z',
                author: 'user',
              },
            ]),
            excluded_from_accounting: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .execute();

      const fingerprint = seedTxFingerprint('kraken', 1, 'tx-21');

      const updated = assertOk(
        await repo.materializeTransactionUserNoteOverrides({
          transactionIds: [21, 22],
          userNoteByFingerprint: new Map([
            [
              fingerprint,
              {
                message: 'Updated note',
                createdAt: '2026-03-15T12:00:00.000Z',
                author: 'user',
              },
            ],
          ]),
        })
      );

      expect(updated).toBe(2);

      const rows = await db
        .selectFrom('transactions')
        .select(['id', 'user_notes_json'])
        .where('id', 'in', [21, 22])
        .orderBy('id', 'asc')
        .execute();

      expect(JSON.parse((rows[0]?.user_notes_json as string | null) ?? '[]')).toEqual([
        {
          message: 'Updated note',
          createdAt: '2026-03-15T12:00:00.000Z',
          author: 'user',
        },
      ]);
      expect(rows[1]?.user_notes_json).toBeNull();
    });

    it('returns zero when scoping is explicitly empty', async () => {
      const updated = assertOk(
        await repo.materializeTransactionUserNoteOverrides({
          accountIds: [],
          userNoteByFingerprint: new Map(),
        })
      );

      expect(updated).toBe(0);
    });
  });

  describe('materializeTransactionMovementRoleOverrides', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedImportSession(db, 1, 1);
    });

    it('materializes an override separately from the processor-authored base role', async () => {
      const transactionId = assertOk(await repo.create(makePersistedTransaction(), 1));
      const transaction = assertOk(await repo.findById(transactionId, 1));
      const movementFingerprint = transaction?.movements.inflows?.[0]?.movementFingerprint;
      expect(movementFingerprint).toBeDefined();

      const updated = assertOk(
        await repo.materializeTransactionMovementRoleOverrides({
          transactionIds: [transactionId],
          movementRoleOverrideByFingerprint: new Map([[movementFingerprint!, 'staking_reward']]),
        })
      );

      expect(updated).toBe(1);

      const row = await db
        .selectFrom('transaction_movements')
        .select(['movement_role', 'movement_role_override'])
        .where('movement_fingerprint', '=', movementFingerprint!)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        movement_role: 'principal',
        movement_role_override: 'staking_reward',
      });

      const refreshed = assertOk(await repo.findById(transactionId, 1));
      expect(refreshed?.movements.inflows?.[0]?.movementRole).toBe('staking_reward');
    });

    it('clears the materialized override and restores the base role without reprocessing', async () => {
      const transactionId = assertOk(await repo.create(makePersistedTransaction(), 1));
      const transaction = assertOk(await repo.findById(transactionId, 1));
      const movementFingerprint = transaction?.movements.inflows?.[0]?.movementFingerprint;
      expect(movementFingerprint).toBeDefined();

      assertOk(
        await repo.materializeTransactionMovementRoleOverrides({
          transactionIds: [transactionId],
          movementRoleOverrideByFingerprint: new Map([[movementFingerprint!, 'staking_reward']]),
        })
      );

      const updated = assertOk(
        await repo.materializeTransactionMovementRoleOverrides({
          transactionIds: [transactionId],
          movementRoleOverrideByFingerprint: new Map(),
        })
      );

      expect(updated).toBe(1);

      const row = await db
        .selectFrom('transaction_movements')
        .select(['movement_role', 'movement_role_override'])
        .where('movement_fingerprint', '=', movementFingerprint!)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        movement_role: 'principal',
        movement_role_override: null,
      });

      const refreshed = assertOk(await repo.findById(transactionId, 1));
      expect(refreshed?.movements.inflows?.[0]?.movementRole).toBe('principal');
    });

    it('returns zero when scoping is explicitly empty', async () => {
      const updated = assertOk(
        await repo.materializeTransactionMovementRoleOverrides({
          accountIds: [],
          movementRoleOverrideByFingerprint: new Map(),
        })
      );

      expect(updated).toBe(0);
    });
  });

  describe('findStoredMovementRoleStateByFingerprint', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedImportSession(db, 1, 1);
    });

    it('returns the processor-authored base role and the current override separately', async () => {
      const transactionId = assertOk(await repo.create(makePersistedTransaction(), 1));
      const transaction = assertOk(await repo.findById(transactionId, 1));
      const movementFingerprint = transaction?.movements.inflows?.[0]?.movementFingerprint;
      expect(movementFingerprint).toBeDefined();

      assertOk(
        await repo.materializeTransactionMovementRoleOverrides({
          transactionIds: [transactionId],
          movementRoleOverrideByFingerprint: new Map([[movementFingerprint!, 'staking_reward']]),
        })
      );

      const state = assertOk(await repo.findStoredMovementRoleStateByFingerprint(movementFingerprint!));

      expect(state).toEqual({
        baseRole: 'principal',
        overrideRole: 'staking_reward',
      });
    });

    it('defaults the base role to principal when no processor-authored role is stored', async () => {
      const transactionId = assertOk(await repo.create(makePersistedTransaction(), 1));
      const transaction = assertOk(await repo.findById(transactionId, 1));
      const movementFingerprint = transaction?.movements.inflows?.[0]?.movementFingerprint;
      expect(movementFingerprint).toBeDefined();

      const state = assertOk(await repo.findStoredMovementRoleStateByFingerprint(movementFingerprint!));

      expect(state).toEqual({
        baseRole: 'principal',
        overrideRole: undefined,
      });
    });
  });

  describe('profile scoping', () => {
    beforeEach(async () => {
      db = await createTestDatabase();
      repo = new TransactionRepository(db);

      await seedProfile(db);
      await db
        .insertInto('profiles')
        .values({
          id: 2,
          profile_key: 'audit',
          display_name: 'audit',
          created_at: new Date().toISOString(),
        })
        .execute();
      await seedAccount(db, 1, 'exchange-api', 'kraken', { profileId: 1 });
      await seedAccount(db, 2, 'exchange-api', 'kraken', { profileId: 2 });
    });

    it('filters findAll by profileId', async () => {
      const txId1 = assertOk(
        await repo.create(makePersistedTransaction({ platformKey: 'kraken', platformKind: 'exchange' }), 1)
      );
      const txId2 = assertOk(
        await repo.create(
          makePersistedTransaction({
            platformKey: 'kraken',
            platformKind: 'exchange',
            identityReference: 'audit-kraken-1',
          }),
          2
        )
      );

      const profileOneTransactions = assertOk(await repo.findAll({ profileId: 1, includeExcluded: true }));
      const profileTwoTransactions = assertOk(await repo.findAll({ profileId: 2, includeExcluded: true }));

      expect(profileOneTransactions.map((tx) => tx.id)).toEqual([txId1]);
      expect(profileTwoTransactions.map((tx) => tx.id)).toEqual([txId2]);
    });

    it('handles large account ID filters without exceeding SQLite variable limits', async () => {
      const txId1 = assertOk(
        await repo.create(makePersistedTransaction({ platformKey: 'kraken', platformKind: 'exchange' }), 1)
      );
      const txId2 = assertOk(
        await repo.create(
          makePersistedTransaction({
            platformKey: 'kraken',
            platformKind: 'exchange',
            identityReference: 'audit-kraken-2',
          }),
          2
        )
      );

      const accountIds = Array.from({ length: 1_200 }, (_, index) => index + 1);

      const transactions = assertOk(await repo.findAll({ accountIds, includeExcluded: true }));
      const count = assertOk(await repo.count({ accountIds, includeExcluded: true }));

      expect(transactions.map((tx) => tx.id)).toEqual([txId1, txId2]);
      expect(count).toBe(2);
    });

    it('returns undefined when findById is scoped to a different profile', async () => {
      const transactionId = assertOk(
        await repo.create(
          makePersistedTransaction({
            platformKey: 'kraken',
            platformKind: 'exchange',
            identityReference: 'default-kraken-1',
          }),
          1
        )
      );

      const sameProfile = assertOk(await repo.findById(transactionId, 1));
      const otherProfile = assertOk(await repo.findById(transactionId, 2));

      expect(sameProfile?.id).toBe(transactionId);
      expect(otherProfile).toBeUndefined();
    });

    it('resolves a transaction by fingerprint ref within the requested profile', async () => {
      const transactionId = assertOk(
        await repo.create(
          makePersistedTransaction({
            platformKey: 'kraken',
            platformKind: 'exchange',
            identityReference: 'default-kraken-ref',
          }),
          1
        )
      );

      assertOk(
        await repo.create(
          makePersistedTransaction({
            platformKey: 'kraken',
            platformKind: 'exchange',
            identityReference: 'audit-kraken-ref',
          }),
          2
        )
      );

      const transaction = assertOk(await repo.findById(transactionId, 1));
      const fingerprintRef = transaction?.txFingerprint.slice(0, 12);

      const resolved = assertOk(await repo.findByFingerprintRef(1, fingerprintRef!));

      expect(resolved?.id).toBe(transactionId);
    });

    it('materializes blockchain confirmation flags as booleans', async () => {
      const transactionId = assertOk(
        await repo.create(
          makePersistedTransaction({
            platformKey: 'ethereum',
            platformKind: 'blockchain',
            identityReference: 'confirmed-bool-ref',
            blockchain: {
              name: 'ethereum',
              transaction_hash: 'confirmed-bool-ref',
              is_confirmed: true,
            },
          }),
          1
        )
      );

      const transaction = assertOk(await repo.findById(transactionId, 1));

      expect(transaction?.blockchain?.is_confirmed).toBe(true);
      expect(typeof transaction?.blockchain?.is_confirmed).toBe('boolean');
    });

    it('returns undefined when a fingerprint ref only matches another profile', async () => {
      const transactionId = assertOk(
        await repo.create(
          makePersistedTransaction({
            platformKey: 'kraken',
            platformKind: 'exchange',
            identityReference: 'audit-only-ref',
          }),
          2
        )
      );

      const transaction = assertOk(await repo.findById(transactionId, 2));
      const fingerprintRef = transaction?.txFingerprint.slice(0, 12);

      const resolved = assertOk(await repo.findByFingerprintRef(1, fingerprintRef!));

      expect(resolved).toBeUndefined();
    });

    it('returns an ambiguity error when multiple transactions share the same fingerprint prefix', async () => {
      const sharedPrefix = 'abc123def456';
      const firstFingerprint = `${sharedPrefix}${'1'.repeat(64 - sharedPrefix.length)}`;
      const secondFingerprint = `${sharedPrefix}${'2'.repeat(64 - sharedPrefix.length)}`;

      await db
        .insertInto('transactions')
        .values([
          {
            id: 101,
            account_id: 1,
            platform_key: 'kraken',
            platform_kind: 'exchange',
            tx_fingerprint: firstFingerprint,
            transaction_status: 'success',
            transaction_datetime: '2025-01-01T00:00:00.000Z',
            excluded_from_accounting: false,
            operation_type: 'deposit',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 102,
            account_id: 1,
            platform_key: 'kraken',
            platform_kind: 'exchange',
            tx_fingerprint: secondFingerprint,
            transaction_status: 'success',
            transaction_datetime: '2025-01-02T00:00:00.000Z',
            excluded_from_accounting: false,
            operation_type: 'deposit',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .execute();

      const result = await repo.findByFingerprintRef(1, sharedPrefix);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(AmbiguousTransactionFingerprintRefError);
      }
    });

    it('loads full transactions across multiple movement lookup batches', async () => {
      const totalTransactions = 1_005;

      for (let index = 1; index <= totalTransactions; index++) {
        const identityReference = `batched-${index}`;
        const txFingerprint = seedTxFingerprint('kraken', 1, identityReference);
        const transactionDatetime = new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString();

        await db
          .insertInto('transactions')
          .values({
            id: index,
            account_id: 1,
            platform_key: 'kraken',
            platform_kind: 'exchange',
            tx_fingerprint: txFingerprint,
            transaction_status: 'success',
            transaction_datetime: transactionDatetime,
            excluded_from_accounting: false,
            operation_type: 'deposit',
            created_at: new Date().toISOString(),
          })
          .execute();

        await db
          .insertInto('transaction_movements')
          .values({
            transaction_id: index,
            movement_type: 'inflow',
            movement_fingerprint: seedAssetMovementFingerprint(txFingerprint, 'inflow', {
              assetId: 'exchange:kraken:btc',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
            }),
            asset_id: 'exchange:kraken:btc',
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
      }

      const transactions = assertOk(await repo.findAll({ profileId: 1, includeExcluded: true }));

      expect(transactions).toHaveLength(totalTransactions);
      expect(transactions.every((transaction) => transaction.movements.inflows?.length === 1)).toBe(true);
      expect(transactions[0]?.txFingerprint).toBe(seedTxFingerprint('kraken', 1, 'batched-1'));
      expect(transactions.at(-1)?.txFingerprint).toBe(seedTxFingerprint('kraken', 1, `batched-${totalTransactions}`));
    });
  });
});
