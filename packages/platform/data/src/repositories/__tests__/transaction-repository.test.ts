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
          raw_normalized_data: '{}',
          movements_inflows: undefined,
          movements_outflows: undefined,
          fees_network: undefined,
          fees_platform: undefined,
          fees_total: undefined,
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

  it('should add price when movement has no price', async () => {
    // Create transaction with movement without price
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
        raw_normalized_data: '{}',
        movements_inflows: JSON.stringify([{ asset: 'BTC', amount: '1.0' }]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Add price
    const result = await repository.updateMovementsWithPrices(1, [
      {
        asset: 'BTC',
        price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
        source: 'coingecko',
        fetchedAt: new Date(),
        granularity: 'hour',
      },
    ]);

    expect(result.isOk()).toBe(true);

    // Verify price was added
    const tx = await db.selectFrom('transactions').selectAll().where('id', '=', 1).executeTakeFirst();
    const inflows = JSON.parse(tx!.movements_inflows as string) as {
      amount: string;
      asset: string;
      priceAtTxTime?: {
        fetchedAt: string;
        granularity: string;
        price: { amount: string; currency: string };
        source: string;
      };
    }[];
    expect(inflows[0]).toBeDefined();
    expect(inflows[0]?.priceAtTxTime).toBeDefined();
    expect(inflows[0]?.priceAtTxTime?.source).toBe('coingecko');
    expect(inflows[0]?.priceAtTxTime?.price.amount).toBe('50000');
  });

  it('should NOT overwrite exchange-execution price (authoritative)', async () => {
    // Create transaction with exchange-execution price
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
        raw_normalized_data: '{}',
        movements_inflows: JSON.stringify([
          {
            asset: 'BTC',
            amount: '1.0',
            priceAtTxTime: {
              price: { amount: '50000', currency: 'USD' },
              source: 'exchange-execution',
              fetchedAt: new Date().toISOString(),
              granularity: 'exact',
            },
          },
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Attempt to overwrite with derived-ratio
    const result = await repository.updateMovementsWithPrices(1, [
      {
        asset: 'BTC',
        price: { amount: parseDecimal('48000'), currency: Currency.create('USD') },
        source: 'derived-ratio',
        fetchedAt: new Date(),
        granularity: 'exact',
      },
    ]);

    expect(result.isOk()).toBe(true);

    // Verify exchange-execution price was NOT overwritten
    const tx = await db.selectFrom('transactions').selectAll().where('id', '=', 1).executeTakeFirst();
    const inflows = JSON.parse(tx!.movements_inflows as string) as {
      amount: string;
      asset: string;
      priceAtTxTime?: {
        fetchedAt: string;
        granularity: string;
        price: { amount: string; currency: string };
        source: string;
      };
    }[];
    expect(inflows[0]).toBeDefined();
    expect(inflows[0]?.priceAtTxTime).toBeDefined();
    expect(inflows[0]?.priceAtTxTime?.source).toBe('exchange-execution');
    expect(inflows[0]?.priceAtTxTime?.price.amount).toBe('50000');
  });

  it('should overwrite provider price with derived-ratio', async () => {
    // Create transaction with provider price
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
        raw_normalized_data: '{}',
        movements_inflows: JSON.stringify([
          {
            asset: 'BTC',
            amount: '1.0',
            priceAtTxTime: {
              price: { amount: '50000', currency: 'USD' },
              source: 'coingecko',
              fetchedAt: new Date().toISOString(),
              granularity: 'hour',
            },
          },
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Overwrite with derived-ratio
    const result = await repository.updateMovementsWithPrices(1, [
      {
        asset: 'BTC',
        price: { amount: parseDecimal('48000'), currency: Currency.create('USD') },
        source: 'derived-ratio',
        fetchedAt: new Date(),
        granularity: 'exact',
      },
    ]);

    expect(result.isOk()).toBe(true);

    // Verify provider price was overwritten with derived-ratio
    const tx = await db.selectFrom('transactions').selectAll().where('id', '=', 1).executeTakeFirst();
    const inflows = JSON.parse(tx!.movements_inflows as string) as {
      amount: string;
      asset: string;
      priceAtTxTime?: {
        fetchedAt: string;
        granularity: string;
        price: { amount: string; currency: string };
        source: string;
      };
    }[];
    expect(inflows[0]?.priceAtTxTime).toBeDefined();
    expect(inflows[0]?.priceAtTxTime?.source).toBe('derived-ratio');
    expect(inflows[0]?.priceAtTxTime?.price.amount).toBe('48000');
  });

  it('should overwrite provider price with link-propagated', async () => {
    // Create transaction with provider price
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
        raw_normalized_data: '{}',
        movements_inflows: JSON.stringify([
          {
            asset: 'ETH',
            amount: '10.0',
            priceAtTxTime: {
              price: { amount: '3000', currency: 'USD' },
              source: 'cryptocompare',
              fetchedAt: new Date().toISOString(),
              granularity: 'hour',
            },
          },
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Overwrite with link-propagated
    const result = await repository.updateMovementsWithPrices(1, [
      {
        asset: 'ETH',
        price: { amount: parseDecimal('3100'), currency: Currency.create('USD') },
        source: 'link-propagated',
        fetchedAt: new Date(),
        granularity: 'exact',
      },
    ]);

    expect(result.isOk()).toBe(true);

    // Verify provider price was overwritten with link-propagated
    const tx = await db.selectFrom('transactions').selectAll().where('id', '=', 1).executeTakeFirst();
    const inflows = JSON.parse(tx!.movements_inflows as string) as {
      amount: string;
      asset: string;
      priceAtTxTime?: {
        fetchedAt: string;
        granularity: string;
        price: { amount: string; currency: string };
        source: string;
      };
    }[];
    expect(inflows[0]?.priceAtTxTime?.source).toBe('link-propagated');
    expect(inflows[0]?.priceAtTxTime?.price?.amount).toBe('3100');
  });

  it('should NOT overwrite provider price with another provider price', async () => {
    // Create transaction with coingecko price
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
        raw_normalized_data: '{}',
        movements_inflows: JSON.stringify([
          {
            asset: 'BTC',
            amount: '1.0',
            priceAtTxTime: {
              price: { amount: '50000', currency: 'USD' },
              source: 'coingecko',
              fetchedAt: new Date().toISOString(),
              granularity: 'hour',
            },
          },
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Attempt to overwrite with binance price
    const result = await repository.updateMovementsWithPrices(1, [
      {
        asset: 'BTC',
        price: { amount: parseDecimal('49000'), currency: Currency.create('USD') },
        source: 'binance',
        fetchedAt: new Date(),
        granularity: 'minute',
      },
    ]);

    expect(result.isOk()).toBe(true);

    // Verify coingecko price was NOT overwritten
    const tx = await db.selectFrom('transactions').selectAll().where('id', '=', 1).executeTakeFirst();
    const inflows = JSON.parse(tx!.movements_inflows as string) as {
      amount: string;
      asset: string;
      priceAtTxTime?: {
        fetchedAt: string;
        granularity: string;
        price: { amount: string; currency: string };
        source: string;
      };
    }[];
    expect(inflows[0]?.priceAtTxTime?.source).toBe('coingecko');
    expect(inflows[0]?.priceAtTxTime?.price?.amount).toBe('50000');
  });
});
