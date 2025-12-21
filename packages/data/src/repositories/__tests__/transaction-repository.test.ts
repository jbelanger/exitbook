/* eslint-disable unicorn/no-null -- acceptable for tests */
import type { UniversalTransactionData } from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';
import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TransactionRepository } from '../transaction-repository.js';

describe('TransactionRepository - delete methods', () => {
  let db: KyselyDB;
  let repository: TransactionRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new TransactionRepository(db);

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
          movements_inflows: undefined,
          movements_outflows: undefined,
          fees: undefined,
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

  describe('deleteBySource', () => {
    it('should delete all transactions from a specific source', async () => {
      // Verify initial state
      const initialTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(initialTransactions).toHaveLength(5);

      // Delete kraken transactions
      const result = await repository.deleteBySource('kraken');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 transactions
      }

      // Verify only ethereum transactions remain
      const remainingTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(remainingTransactions).toHaveLength(2);
      expect(remainingTransactions.every((t) => t.source_name === 'ethereum')).toBe(true);
    });

    it('should return 0 when no transactions match the source', async () => {
      const result = await repository.deleteBySource('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      // Verify all transactions remain
      const allTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(allTransactions).toHaveLength(5);
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteBySource('kraken');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('deleteAll', () => {
    it('should delete all transactions', async () => {
      // Verify initial state
      const initialTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(initialTransactions).toHaveLength(5);

      // Delete all transactions
      const result = await repository.deleteAll();

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

      const result = await repository.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('TransactionRepository - scam token filtering', () => {
  let db: KyselyDB;
  let repository: TransactionRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new TransactionRepository(db);

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
          movements_inflows: JSON.stringify([{ assetSymbol: 'ETH', grossAmount: '1.0', netAmount: '1.0' }]),
          operation_type: 'transfer' as const,
          created_at: new Date().toISOString(),
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
          movements_inflows: JSON.stringify([{ assetSymbol: 'SCAM', grossAmount: '1000.0', netAmount: '1000.0' }]),
          operation_type: 'transfer' as const,
          created_at: new Date().toISOString(),
        })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('should exclude scam tokens by default', async () => {
    const result = await repository.getTransactions({ accountId: 1 });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should only return the 3 non-scam transactions
      expect(result.value).toHaveLength(3);
      expect(result.value.every((tx) => !tx.notes?.some((note) => note.type === 'SCAM_TOKEN'))).toBe(true);
    }
  });

  it('should exclude scam tokens when includeExcluded is false', async () => {
    const result = await repository.getTransactions({ accountId: 1, includeExcluded: false });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(3);
      expect(result.value.every((tx) => !tx.notes?.some((note) => note.type === 'SCAM_TOKEN'))).toBe(true);
    }
  });

  it('should include scam tokens when includeExcluded is true', async () => {
    const result = await repository.getTransactions({ accountId: 1, includeExcluded: true });

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

    // Verify through repository
    const result = await repository.getTransactions({ accountId: 1 });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(3);
    }
  });
});

describe('TransactionRepository - isSpam field', () => {
  let db: KyselyDB;
  let repository: TransactionRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new TransactionRepository(db);

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
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await repository.save(transaction, 1);

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
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await repository.save(transaction, 1);

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
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await repository.save(transaction, 1);

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
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await repository.save(transaction, 1);

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
      status: 'success' as const,
      timestamp: Date.now(),
    };

    const result = await repository.save(spamTransaction, 1);

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

describe('TransactionRepository - updateMovementsWithPrices', () => {
  let db: KyselyDB;
  let repository: TransactionRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new TransactionRepository(db);

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
        movements_inflows: JSON.stringify([{ assetSymbol: 'BTC', grossAmount: '1.0', netAmount: '1.0' }]),
        fees: JSON.stringify([{ assetSymbol: 'BTC', amount: '0.0001', scope: 'network', settlement: 'on-chain' }]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Build enriched transaction (repository just persists what it's told)
    const enrichedTx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      externalId: 'tx-1',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
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

    const result = await repository.updateMovementsWithPrices(enrichedTx);

    expect(result.isOk()).toBe(true);

    // Verify movements and fees were persisted correctly
    const tx = await db.selectFrom('transactions').selectAll().where('id', '=', 1).executeTakeFirst();
    const inflows = JSON.parse(tx!.movements_inflows as string) as {
      assetSymbol: string;
      grossAmount: string;
      netAmount: string;
      priceAtTxTime?: {
        fetchedAt: string;
        granularity: string;
        price: { amount: string; currency: string };
        source: string;
      };
    }[];
    const fees = JSON.parse(tx!.fees as string) as {
      amount: string;
      assetSymbol: string;
      priceAtTxTime?: {
        fetchedAt: string;
        granularity: string;
        price: { amount: string; currency: string };
        source: string;
      };
      scope: string;
      settlement: string;
    }[];

    expect(inflows[0]).toBeDefined();
    expect(inflows[0]?.priceAtTxTime).toBeDefined();
    expect(inflows[0]?.priceAtTxTime?.source).toBe('coingecko');
    expect(inflows[0]?.priceAtTxTime?.price.amount).toBe('50000');

    // Verify fees were enriched
    expect(fees[0]).toBeDefined();
    expect(fees[0]?.priceAtTxTime).toBeDefined();
    expect(fees[0]?.priceAtTxTime?.source).toBe('coingecko');
    expect(fees[0]?.priceAtTxTime?.price.amount).toBe('50000');
  });

  it('should return error when transaction ID does not exist', async () => {
    const enrichedTx: UniversalTransactionData = {
      id: 999, // Non-existent ID
      accountId: 1,
      externalId: 'tx-999',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
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

    const result = await repository.updateMovementsWithPrices(enrichedTx);

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('Transaction 999 not found');
  });
});

// Skipping tests for deprecated behavior - transactions are now scoped to accounts, not sessions
// Deduplication happens at database level via unique constraints on (account_id, blockchain_transaction_hash)
describe.skip('TransactionRepository - deduplication across sessions (deprecated)', () => {
  let db: KyselyDB;
  let repository: TransactionRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new TransactionRepository(db);

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

    // Create multiple import sessions for the same account
    await db
      .insertInto('import_sessions')
      .values([
        {
          id: 1,
          account_id: 1,
          started_at: new Date('2024-01-01').toISOString(),
          status: 'completed',
          transactions_imported: 3,
          transactions_skipped: 0,
          created_at: new Date('2024-01-01').toISOString(),
          completed_at: new Date('2024-01-01').toISOString(),
        },
        {
          id: 2,
          account_id: 1,
          started_at: new Date('2024-01-02').toISOString(),
          status: 'completed',
          transactions_imported: 5,
          transactions_skipped: 0,
          created_at: new Date('2024-01-02').toISOString(),
          completed_at: new Date('2024-01-02').toISOString(),
        },
      ])
      .execute();

    // Create transactions in first session (3 unique transactions)
    for (let i = 1; i <= 3; i++) {
      await db
        .insertInto('transactions')
        .values({
          id: i,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange' as const,
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date('2024-01-01').toISOString(),
          is_spam: false,
          excluded_from_accounting: false,
          movements_inflows: JSON.stringify([{ assetSymbol: 'BTC', grossAmount: '1.0', netAmount: '1.0' }]),
          operation_type: 'deposit' as const,
          created_at: new Date('2024-01-01').toISOString(),
        })
        .execute();
    }

    // Create transactions in second session:
    // - tx-1 and tx-2 are duplicates from session 1
    // - tx-4 and tx-5 are new unique transactions
    const secondSessionTxs = [
      { id: 4, externalId: 'tx-1' }, // Duplicate
      { id: 5, externalId: 'tx-2' }, // Duplicate
      { id: 6, externalId: 'tx-4' }, // New
      { id: 7, externalId: 'tx-5' }, // New
    ];

    for (const { id, externalId } of secondSessionTxs) {
      await db
        .insertInto('transactions')
        .values({
          id,
          account_id: 2,
          source_name: 'kraken',
          source_type: 'exchange' as const,
          external_id: externalId,
          transaction_status: 'success' as const,
          transaction_datetime: new Date('2024-01-02').toISOString(),
          is_spam: false,
          excluded_from_accounting: false,
          movements_inflows: JSON.stringify([{ assetSymbol: 'BTC', grossAmount: '1.0', netAmount: '1.0' }]),
          operation_type: 'deposit' as const,
          created_at: new Date('2024-01-02').toISOString(),
        })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('should deduplicate transactions when aggregating across multiple sessions', async () => {
    // Query all completed sessions for account 1
    const result = await repository.getTransactions({
      accountId: 1,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const transactions = result.value;

      // Should have 5 unique transactions after deduplication:
      // - tx-1, tx-2, tx-3 from session 1
      // - tx-4, tx-5 from session 2 (new)
      // - duplicates of tx-1 and tx-2 from session 2 should be filtered out
      expect(transactions).toHaveLength(5);

      // Verify the unique external IDs
      const externalIds = transactions.map((tx) => tx.externalId).sort();
      expect(externalIds).toEqual(['tx-1', 'tx-2', 'tx-3', 'tx-4', 'tx-5']);

      // Verify deduplication kept the first occurrence (from session 1 for duplicates)
      const tx1 = transactions.find((tx) => tx.externalId === 'tx-1');
      expect(tx1?.id).toBe(1); // From session 1, not session 2 (id 4)

      const tx2 = transactions.find((tx) => tx.externalId === 'tx-2');
      expect(tx2?.id).toBe(2); // From session 1, not session 2 (id 5)
    }
  });

  it('should not deduplicate when querying a single session', async () => {
    // Query only session 2
    const result = await repository.getTransactions({
      accountId: 2,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should return all 4 transactions from session 2 without deduplication
      expect(result.value).toHaveLength(4);
    }
  });

  it('should log warning when duplicates are found and removed', async () => {
    // This test documents that deduplication happens and logs a warning
    // The actual logging is tested by checking the behavior is correct
    const result = await repository.getTransactions({
      accountId: 1,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // 7 total transactions in DB, but only 5 unique after deduplication
      expect(result.value).toHaveLength(5);
      // The warning is logged internally with message about 2 duplicates removed
    }
  });
});
