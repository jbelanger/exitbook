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

    // Create mock import sessions for different sources
    await db
      .insertInto('data_sources')
      .values([
        {
          id: 1,
          source_type: 'exchange',
          source_id: 'kraken',
          started_at: new Date().toISOString(),
          status: 'completed',
          import_params: '{}',
          import_result_metadata: '{}',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        {
          id: 2,
          source_type: 'blockchain',
          source_id: 'ethereum',
          started_at: new Date().toISOString(),
          status: 'completed',
          import_params: '{}',
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
          data_source_id: i <= 3 ? 1 : 2, // First 3 from kraken, last 2 from ethereum
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

    // Create mock import session
    await db
      .insertInto('data_sources')
      .values({
        id: 1,
        source_type: 'blockchain',
        source_id: 'ethereum',
        started_at: new Date().toISOString(),
        status: 'completed',
        import_params: '{}',
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
          data_source_id: 1,
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
          data_source_id: 1,
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
    const allTx = await db.selectFrom('transactions').selectAll().where('data_source_id', '=', 1).execute();
    expect(allTx).toHaveLength(5);

    const nonExcluded = await db
      .selectFrom('transactions')
      .selectAll()
      .where('data_source_id', '=', 1)
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

    // Create mock import session
    await db
      .insertInto('data_sources')
      .values({
        id: 1,
        source_type: 'exchange',
        source_id: 'kraken',
        started_at: new Date().toISOString(),
        status: 'completed',
        import_params: '{}',
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
        data_source_id: 1,
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
            asset: Currency.create('BTC'),
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
          asset: Currency.create('BTC'),
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
            asset: Currency.create('BTC'),
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
