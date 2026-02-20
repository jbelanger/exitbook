/* eslint-disable unicorn/no-null -- acceptable for tests */
import type { UniversalTransactionData } from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';
import { createTestDatabase, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTransactionQueries, type TransactionQueries } from '../transaction-queries.js';

describe('TransactionQueries - delete methods', () => {
  let db: KyselyDB;
  let queries: TransactionQueries;

  beforeEach(async () => {
    db = await createTestDatabase();
    queries = createTransactionQueries(db);

    // Create default user
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();

    // Create mock accounts
    await db
      .insertInto('accounts')
      .values([
        {
          id: 1,
          user_id: 1,
          parent_account_id: null,
          account_type: 'exchange-api',
          source_name: 'kraken',
          identifier: 'test-api-key',
          provider_name: null,
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        },
        {
          id: 2,
          user_id: 1,
          parent_account_id: null,
          account_type: 'blockchain',
          source_name: 'ethereum',
          identifier: '0x123',
          provider_name: null,
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ])
      .execute();

    // Create mock import sessions for different sources
    await db
      .insertInto('import_sessions')
      .values([
        {
          id: 1,
          account_id: 1,
          started_at: new Date().toISOString(),
          status: 'completed',
          transactions_imported: 0,
          transactions_skipped: 0,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        {
          id: 2,
          account_id: 2,
          started_at: new Date().toISOString(),
          status: 'completed',
          transactions_imported: 0,
          transactions_skipped: 0,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ])
      .execute();

    // Create test transactions with different sources
    for (let i = 1; i <= 5; i++) {
      await db
        .insertInto('transactions')
        .values({
          id: i,
          account_id: i <= 3 ? 1 : 2, // First 3 from kraken, last 2 from ethereum
          source_name: i <= 3 ? 'kraken' : 'ethereum',
          source_type: i <= 3 ? ('exchange' as const) : ('blockchain' as const),
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          from_address: undefined,
          to_address: undefined,
          notes_json: undefined,
          is_spam: false,
          excluded_from_accounting: false,
          operation_category: undefined,
          operation_type: 'deposit' as const,
          blockchain_name: undefined,
          blockchain_block_height: undefined,
          blockchain_transaction_hash: undefined,
          blockchain_is_confirmed: undefined,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('deleteAll', () => {
    it('should delete all transactions', async () => {
      // Verify initial state
      const initialTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(initialTransactions).toHaveLength(5);

      // Delete all transactions
      const result = await queries.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      // Verify no transactions remain
      const remainingTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(remainingTransactions).toHaveLength(0);
    });

    it('should return 0 when no transactions exist', async () => {
      // Delete all transactions first
      await db.deleteFrom('transactions').execute();

      const result = await queries.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.deleteAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('TransactionQueries - scam token filtering', () => {
  let db: KyselyDB;
  let queries: TransactionQueries;

  beforeEach(async () => {
    db = await createTestDatabase();
    queries = createTransactionQueries(db);

    // Create default user and account
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
    await db
      .insertInto('accounts')
      .values({
        id: 1,
        user_id: 1,
        account_type: 'blockchain',
        source_name: 'ethereum',
        identifier: '0x123',
        provider_name: null,
        parent_account_id: null,
        last_cursor: null,
        last_balance_check_at: null,
        verification_metadata: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();

    // Create mock import session
    await db
      .insertInto('import_sessions')
      .values({
        id: 1,
        account_id: 1,
        started_at: new Date().toISOString(),
        status: 'completed',
        transactions_imported: 0,
        transactions_skipped: 0,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .execute();

    // Create regular transactions
    for (let i = 1; i <= 3; i++) {
      await db
        .insertInto('transactions')
        .values({
          id: i,
          account_id: 1,
          source_name: 'ethereum',
          source_type: 'blockchain' as const,
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'transfer' as const,
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

    // Create scam token transactions
    for (let i = 4; i <= 5; i++) {
      await db
        .insertInto('transactions')
        .values({
          id: i,
          account_id: 1,
          source_name: 'ethereum',
          source_type: 'blockchain' as const,
          external_id: `scam-tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          notes_json: JSON.stringify([{ type: 'SCAM_TOKEN', message: 'Scam token detected', severity: 'error' }]),
          is_spam: true,
          excluded_from_accounting: true, // Scam tokens excluded
          operation_type: 'transfer' as const,
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

  afterEach(async () => {
    await db.destroy();
  });

  it('should exclude scam tokens by default', async () => {
    const result = await queries.getTransactions({ accountId: 1 });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should only return the 3 non-scam transactions
      expect(result.value).toHaveLength(3);
      expect(result.value.every((tx) => !tx.notes?.some((note) => note.type === 'SCAM_TOKEN'))).toBe(true);
    }
  });

  it('should exclude scam tokens when includeExcluded is false', async () => {
    const result = await queries.getTransactions({ accountId: 1, includeExcluded: false });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(3);
      expect(result.value.every((tx) => !tx.notes?.some((note) => note.type === 'SCAM_TOKEN'))).toBe(true);
    }
  });

  it('should include scam tokens when includeExcluded is true', async () => {
    const result = await queries.getTransactions({ accountId: 1, includeExcluded: true });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should return all 5 transactions (3 regular + 2 scam)
      expect(result.value).toHaveLength(5);
      const scamTransactions = result.value.filter((tx) => tx.notes?.some((note) => note.type === 'SCAM_TOKEN'));
      expect(scamTransactions).toHaveLength(2);
    }
  });

  it('should exclude scam tokens from balance calculations', async () => {
    // Verify at the SQL level that the filter works
    const allTx = await db.selectFrom('transactions').selectAll().where('account_id', '=', 1).execute();
    expect(allTx).toHaveLength(5);

    const nonExcluded = await db
      .selectFrom('transactions')
      .selectAll()
      .where('account_id', '=', 1)
      .where('excluded_from_accounting', '=', false)
      .execute();
    expect(nonExcluded).toHaveLength(3);

    const result = await queries.getTransactions({ accountId: 1 });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(3);
    }
  });
});

describe('TransactionQueries - isSpam field', () => {
  let db: KyselyDB;
  let queries: TransactionQueries;

  beforeEach(async () => {
    db = await createTestDatabase();
    queries = createTransactionQueries(db);

    // Create default user and account
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
    await db
      .insertInto('accounts')
      .values({
        id: 1,
        user_id: 1,
        account_type: 'blockchain',
        source_name: 'ethereum',
        identifier: '0x123',
        provider_name: null,
        parent_account_id: null,
        last_cursor: null,
        last_balance_check_at: null,
        verification_metadata: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();

    // Create mock import session
    await db
      .insertInto('import_sessions')
      .values({
        id: 1,
        account_id: 1,
        started_at: new Date().toISOString(),
        status: 'completed',
        transactions_imported: 0,
        transactions_skipped: 0,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('should persist isSpam=true and auto-exclude from accounting', async () => {
    const transaction = {
      datetime: new Date().toISOString(),
      externalId: 'spam-tx-1',
      fees: [],
      isSpam: true,
      movements: {
        inflows: [
          {
            assetId: 'test:scam',
            assetSymbol: 'SCAM',
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
      operation: {
        category: 'transfer' as const,
        type: 'deposit' as const,
      },
      source: 'ethereum',
      sourceType: 'blockchain' as const,
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await queries.save(transaction, 1);

    expect(result.isOk()).toBe(true);

    // Verify isSpam was persisted
    const tx = await db
      .selectFrom('transactions')
      .selectAll()
      .where('external_id', '=', 'spam-tx-1')
      .executeTakeFirst();
    expect(tx?.is_spam).toBe(1); // SQLite uses 1 for true
    expect(tx?.excluded_from_accounting).toBe(1); // Should auto-exclude
  });

  it('should persist isSpam=false', async () => {
    const transaction = {
      datetime: new Date().toISOString(),
      externalId: 'legit-tx-1',
      fees: [],
      isSpam: false,
      movements: {
        inflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH',
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer' as const,
        type: 'deposit' as const,
      },
      source: 'ethereum',
      sourceType: 'blockchain' as const,
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await queries.save(transaction, 1);

    expect(result.isOk()).toBe(true);

    // Verify isSpam was persisted as false
    const tx = await db
      .selectFrom('transactions')
      .selectAll()
      .where('external_id', '=', 'legit-tx-1')
      .executeTakeFirst();
    expect(tx?.is_spam).toBe(0); // SQLite uses 0 for false
    expect(tx?.excluded_from_accounting).toBe(0); // Should NOT exclude
  });

  it('should default isSpam to false when not specified', async () => {
    const transaction = {
      datetime: new Date().toISOString(),
      externalId: 'normal-tx-1',
      fees: [],
      movements: {
        inflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH',
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
          },
        ],
        outflows: [],
      },
      operation: {
        category: 'transfer' as const,
        type: 'deposit' as const,
      },
      source: 'ethereum',
      sourceType: 'blockchain' as const,
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await queries.save(transaction, 1);

    expect(result.isOk()).toBe(true);

    // Verify isSpam defaults to false
    const tx = await db
      .selectFrom('transactions')
      .selectAll()
      .where('external_id', '=', 'normal-tx-1')
      .executeTakeFirst();
    expect(tx?.is_spam).toBe(0); // SQLite uses 0 for false (default)
  });

  it('should respect explicit excludedFromAccounting even when isSpam=true', async () => {
    const transaction = {
      datetime: new Date().toISOString(),
      excludedFromAccounting: false, // Explicitly set to false
      externalId: 'spam-tx-2',
      fees: [],
      isSpam: true,
      movements: {
        inflows: [],
        outflows: [],
      },
      operation: {
        category: 'transfer' as const,
        type: 'deposit' as const,
      },
      source: 'ethereum',
      sourceType: 'blockchain' as const,
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await queries.save(transaction, 1);

    expect(result.isOk()).toBe(true);

    // Verify explicit excludedFromAccounting=false is respected
    const tx = await db
      .selectFrom('transactions')
      .selectAll()
      .where('external_id', '=', 'spam-tx-2')
      .executeTakeFirst();
    expect(tx?.is_spam).toBe(1);
    expect(tx?.excluded_from_accounting).toBe(0); // Should NOT auto-exclude when explicitly set
  });

  it('should use isSpam for auto-exclusion when excludedFromAccounting not specified', async () => {
    const spamTransaction = {
      datetime: new Date().toISOString(),
      externalId: 'spam-tx-3',
      fees: [],
      isSpam: true,
      movements: {
        inflows: [],
        outflows: [],
      },
      operation: {
        category: 'transfer' as const,
        type: 'deposit' as const,
      },
      source: 'ethereum',
      sourceType: 'blockchain' as const,
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await queries.save(spamTransaction, 1);

    expect(result.isOk()).toBe(true);

    // Verify isSpam=true causes auto-exclusion
    const tx = await db
      .selectFrom('transactions')
      .selectAll()
      .where('external_id', '=', 'spam-tx-3')
      .executeTakeFirst();
    expect(tx?.is_spam).toBe(1);
    expect(tx?.excluded_from_accounting).toBe(1); // Should auto-exclude
  });
});

describe('TransactionQueries - updateMovementsWithPrices', () => {
  let db: KyselyDB;
  let queries: TransactionQueries;

  beforeEach(async () => {
    db = await createTestDatabase();
    queries = createTransactionQueries(db);

    // Create default user and account
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
    await db
      .insertInto('accounts')
      .values({
        id: 1,
        user_id: 1,
        account_type: 'exchange-api',
        source_name: 'kraken',
        identifier: 'test-api-key',
        provider_name: null,
        parent_account_id: null,
        last_cursor: null,
        last_balance_check_at: null,
        verification_metadata: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();

    // Create mock import session
    await db
      .insertInto('import_sessions')
      .values({
        id: 1,
        account_id: 1,
        started_at: new Date().toISOString(),
        status: 'completed',
        transactions_imported: 0,
        transactions_skipped: 0,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('should persist enriched movements and fees with prices', async () => {
    // Create transaction with movements and fees without prices
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

    // Build enriched transaction (repository just persists what it's told)
    const enrichedTx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      externalId: 'tx-1',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      sourceType: 'exchange' as const,
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
              granularity: 'hour' as const,
            },
          },
        ],
        outflows: [],
      },
      fees: [
        {
          assetId: 'test:btc',
          assetSymbol: 'BTC',
          amount: parseDecimal('0.0001'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
            source: 'coingecko',
            fetchedAt: new Date(),
            granularity: 'hour' as const,
          },
        },
      ],
    };

    const result = await queries.updateMovementsWithPrices(enrichedTx);

    expect(result.isOk()).toBe(true);

    // Verify movements and fees were persisted correctly
    const movements = await db
      .selectFrom('transaction_movements')
      .selectAll()
      .where('transaction_id', '=', 1)
      .orderBy('position', 'asc')
      .execute();

    const inflow = movements.find((m) => m.movement_type === 'inflow');
    const fee = movements.find((m) => m.movement_type === 'fee');

    expect(inflow).toBeDefined();
    expect(inflow?.price_source).toBe('coingecko');
    expect(inflow?.price_amount).toBe('50000');

    expect(fee).toBeDefined();
    expect(fee?.price_source).toBe('coingecko');
    expect(fee?.price_amount).toBe('50000');
  });

  it('should replace old movement rows and preserve position ordering', async () => {
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

    const enrichedTx: UniversalTransactionData = {
      id: 2,
      accountId: 1,
      externalId: 'tx-2',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      sourceType: 'exchange' as const,
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
              granularity: 'hour' as const,
            },
          },
        ],
        outflows: [
          {
            assetId: 'test:usdt',
            assetSymbol: 'USDT',
            grossAmount: parseDecimal('50000'),
            netAmount: parseDecimal('50000'),
            priceAtTxTime: {
              price: { amount: parseDecimal('1'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
              granularity: 'hour' as const,
            },
          },
        ],
      },
      fees: [
        {
          assetId: 'test:btc',
          assetSymbol: 'BTC',
          amount: parseDecimal('0.0001'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
            source: 'coingecko',
            fetchedAt: new Date(),
            granularity: 'hour' as const,
          },
        },
      ],
    };

    const result = await queries.updateMovementsWithPrices(enrichedTx);

    expect(result.isOk()).toBe(true);

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

  it('should reject invalid movement price metadata before persisting', async () => {
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

    const enrichedTx: UniversalTransactionData = {
      id: 3,
      accountId: 1,
      externalId: 'tx-3',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      sourceType: 'exchange' as const,
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
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

    const result = await queries.updateMovementsWithPrices(enrichedTx);

    expect(result.isErr()).toBe(true);
    expect(result.isErr() ? result.error.message : '').toContain('Invalid inflow movement data');

    const movements = await db
      .selectFrom('transaction_movements')
      .selectAll()
      .where('transaction_id', '=', 3)
      .orderBy('position', 'asc')
      .execute();
    expect(movements).toHaveLength(1);
    expect(movements[0]?.price_source).toBeNull();
  });

  it('should cascade-delete movement rows when transaction is deleted', async () => {
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

  it('should return error when transaction ID does not exist', async () => {
    const enrichedTx: UniversalTransactionData = {
      id: 999, // Non-existent ID
      accountId: 1,
      externalId: 'tx-999',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      sourceType: 'exchange' as const,
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
              granularity: 'hour' as const,
            },
          },
        ],
        outflows: [],
      },
      fees: [],
    };

    const result = await queries.updateMovementsWithPrices(enrichedTx);

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('Transaction 999 not found');
  });
});
