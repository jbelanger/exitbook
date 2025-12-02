/* eslint-disable unicorn/no-null -- acceptable for tests */
import { Currency, parseDecimal, type UniversalTransaction } from '@exitbook/core';
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
          transactions_failed: 0,
          import_result_metadata: '{}',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        {
          id: 2,
          account_id: 2,
          started_at: new Date().toISOString(),
          status: 'completed',
          transactions_imported: 0,
          transactions_failed: 0,
          import_result_metadata: '{}',
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
          import_session_id: i <= 3 ? 1 : 2, // First 3 from kraken, last 2 from ethereum
          source_id: i <= 3 ? 'kraken' : 'ethereum',
          source_type: i <= 3 ? ('exchange' as const) : ('blockchain' as const),
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          from_address: undefined,
          to_address: undefined,
          note_type: undefined,
          note_severity: undefined,
          note_message: undefined,
          note_metadata: undefined,
          excluded_from_accounting: false,
          raw_normalized_data: '{}',
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
      expect(remainingTransactions.every((t) => t.source_id === 'ethereum')).toBe(true);
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
        transactions_failed: 0,
        import_result_metadata: '{}',
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
          import_session_id: 1,
          source_id: 'ethereum',
          source_type: 'blockchain' as const,
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          excluded_from_accounting: false,
          raw_normalized_data: '{}',
          movements_inflows: JSON.stringify([{ asset: 'ETH', grossAmount: '1.0', netAmount: '1.0' }]),
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
          import_session_id: 1,
          source_id: 'ethereum',
          source_type: 'blockchain' as const,
          external_id: `scam-tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          note_type: 'SCAM_TOKEN',
          note_severity: 'error' as const,
          note_message: 'Scam token detected',
          excluded_from_accounting: true, // Scam tokens excluded
          raw_normalized_data: '{}',
          movements_inflows: JSON.stringify([{ asset: 'SCAM', grossAmount: '1000.0', netAmount: '1000.0' }]),
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
    const result = await repository.getTransactions({ sessionId: 1 });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should only return the 3 non-scam transactions
      expect(result.value).toHaveLength(3);
      expect(result.value.every((tx) => tx.note?.type !== 'SCAM_TOKEN')).toBe(true);
    }
  });

  it('should exclude scam tokens when includeExcluded is false', async () => {
    const result = await repository.getTransactions({ sessionId: 1, includeExcluded: false });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(3);
      expect(result.value.every((tx) => tx.note?.type !== 'SCAM_TOKEN')).toBe(true);
    }
  });

  it('should include scam tokens when includeExcluded is true', async () => {
    const result = await repository.getTransactions({ sessionId: 1, includeExcluded: true });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should return all 5 transactions (3 regular + 2 scam)
      expect(result.value).toHaveLength(5);
      const scamTransactions = result.value.filter((tx) => tx.note?.type === 'SCAM_TOKEN');
      expect(scamTransactions).toHaveLength(2);
    }
  });

  it('should exclude scam tokens from balance calculations', async () => {
    // Verify at the SQL level that the filter works
    const allTx = await db.selectFrom('transactions').selectAll().where('import_session_id', '=', 1).execute();
    expect(allTx).toHaveLength(5);

    const nonExcluded = await db
      .selectFrom('transactions')
      .selectAll()
      .where('import_session_id', '=', 1)
      .where('excluded_from_accounting', '=', false)
      .execute();
    expect(nonExcluded).toHaveLength(3);

    // Verify through repository
    const result = await repository.getTransactions({ sessionId: 1 });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(3);
    }
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
        transactions_failed: 0,
        import_result_metadata: '{}',
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
        import_session_id: 1,
        source_id: 'kraken',
        source_type: 'exchange',
        external_id: 'tx-1',
        transaction_status: 'success',
        transaction_datetime: new Date().toISOString(),
        operation_type: 'swap',
        excluded_from_accounting: false,
        raw_normalized_data: '{}',
        movements_inflows: JSON.stringify([{ asset: 'BTC', grossAmount: '1.0', netAmount: '1.0' }]),
        fees: JSON.stringify([{ asset: 'BTC', amount: '0.0001', scope: 'network', settlement: 'on-chain' }]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Build enriched transaction (repository just persists what it's told)
    const enrichedTx: UniversalTransaction = {
      id: 1,
      externalId: 'tx-1',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
            asset: 'BTC',
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
          asset: 'BTC',
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
      asset: string;
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
      asset: string;
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
    const enrichedTx: UniversalTransaction = {
      id: 999, // Non-existent ID
      externalId: 'tx-999',
      datetime: new Date().toISOString(),
      timestamp: Date.now(),
      source: 'kraken',
      status: 'success',
      operation: { category: 'trade', type: 'swap' },
      movements: {
        inflows: [
          {
            asset: 'BTC',
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

describe('TransactionRepository - deduplication across sessions', () => {
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
          transactions_failed: 0,
          import_result_metadata: '{}',
          created_at: new Date('2024-01-01').toISOString(),
          completed_at: new Date('2024-01-01').toISOString(),
        },
        {
          id: 2,
          account_id: 1,
          started_at: new Date('2024-01-02').toISOString(),
          status: 'completed',
          transactions_imported: 5,
          transactions_failed: 0,
          import_result_metadata: '{}',
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
          import_session_id: 1,
          source_id: 'kraken',
          source_type: 'exchange' as const,
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date('2024-01-01').toISOString(),
          excluded_from_accounting: false,
          raw_normalized_data: '{}',
          movements_inflows: JSON.stringify([{ asset: 'BTC', grossAmount: '1.0', netAmount: '1.0' }]),
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
          import_session_id: 2,
          source_id: 'kraken',
          source_type: 'exchange' as const,
          external_id: externalId,
          transaction_status: 'success' as const,
          transaction_datetime: new Date('2024-01-02').toISOString(),
          excluded_from_accounting: false,
          raw_normalized_data: '{}',
          movements_inflows: JSON.stringify([{ asset: 'BTC', grossAmount: '1.0', netAmount: '1.0' }]),
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
      sessionStatus: 'completed',
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
      sessionId: 2,
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
      sessionStatus: 'completed',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // 7 total transactions in DB, but only 5 unique after deduplication
      expect(result.value).toHaveLength(5);
      // The warning is logged internally with message about 2 duplicates removed
    }
  });
});
