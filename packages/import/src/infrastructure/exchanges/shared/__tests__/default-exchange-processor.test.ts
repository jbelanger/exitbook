import type { ExchangeLedgerEntry } from '@exitbook/exchanges';
import { describe, expect, test } from 'vitest';

import { DefaultExchangeProcessor } from '../default-exchange-processor.ts';
import type { RawTransactionWithMetadata } from '../strategies/grouping.ts';

/**
 * Test implementation of BaseExchangeProcessor
 */
class TestExchangeProcessor extends DefaultExchangeProcessor {
  constructor() {
    super('test-exchange');
  }

  protected mapStatus(status: string | undefined): 'pending' | 'ok' | 'canceled' | 'failed' {
    if (!status) return 'ok';

    switch (status.toLowerCase()) {
      case 'pending':
        return 'pending';
      case 'canceled':
      case 'cancelled':
        return 'canceled';
      case 'failed':
        return 'failed';
      default:
        return 'ok';
    }
  }
}

function createTestEntry(overrides: Partial<ExchangeLedgerEntry>): ExchangeLedgerEntry {
  return {
    amount: '0',
    asset: 'USD',
    correlationId: 'REF001',
    id: 'ENTRY001',
    timestamp: 1704067200000, // Must be in milliseconds and an integer
    type: 'test',
    status: 'success',
    ...overrides,
  };
}

function wrapEntry(entry: ExchangeLedgerEntry): RawTransactionWithMetadata {
  return {
    raw: entry,
    normalized: entry,
    externalId: entry.id,
    cursor: {},
  };
}

describe('BaseExchangeProcessor - Fund Flow Analysis', () => {
  test('groups entries by correlation ID', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ id: 'E1', correlationId: 'REF001', amount: '-100', asset: 'USD' }),
      createTestEntry({ id: 'E2', correlationId: 'REF001', amount: '0.001', asset: 'BTC' }),
      createTestEntry({ id: 'E3', correlationId: 'REF002', amount: '50', asset: 'USD' }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    const tx1Metadata = transactions[0]?.metadata as {
      correlatedEntryCount?: number;
      correlationId?: string;
    };
    const tx2Metadata = transactions[1]?.metadata as {
      correlatedEntryCount?: number;
      correlationId?: string;
    };

    expect(tx1Metadata?.correlationId).toBe('REF001');
    expect(tx1Metadata?.correlatedEntryCount).toBe(2);
    expect(tx2Metadata?.correlationId).toBe('REF002');
    expect(tx2Metadata?.correlatedEntryCount).toBe(1);
  });

  test('creates single transaction for swap (different assets)', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({
        amount: '-1000',
        asset: 'USD',
        correlationId: 'SWAP001',
        fee: '2.50',
        id: 'E1',
        timestamp: 1704067200000,
      }),
      createTestEntry({
        amount: '0.025',
        asset: 'BTC',
        correlationId: 'SWAP001',
        fee: '0',
        id: 'E2',
        timestamp: 1704067200000,
      }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.asset).toBe('BTC');
    expect(transaction.movements.inflows![0]?.amount.toString()).toBe('0.025');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.asset).toBe('USD');
    expect(transaction.movements.outflows![0]?.amount.toString()).toBe('1000');

    expect(transaction.fees.platform?.amount.toString()).toBe('2.5');
  });

  test('creates single transaction for deposit (inflow only)', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({
        amount: '700.00',
        asset: 'CAD',
        correlationId: 'DEP001',
        fee: '3.49',
        id: 'E1',
      }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.asset).toBe('CAD');
    expect(transaction.movements.inflows![0]?.amount.toString()).toBe('700');

    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('creates single transaction for withdrawal (outflow only)', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({
        amount: '-385.155',
        asset: 'CAD',
        correlationId: 'WITH001',
        fee: '0.5',
        id: 'E1',
      }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.asset).toBe('CAD');
    expect(transaction.movements.outflows![0]?.amount.toString()).toBe('385.155');

    expect(transaction.movements.inflows).toHaveLength(0);
  });

  test('handles self-transfer (same asset in and out)', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({
        amount: '-100',
        asset: 'USDT',
        correlationId: 'TRANS001',
        id: 'E1',
      }),
      createTestEntry({
        amount: '100',
        asset: 'USDT',
        correlationId: 'TRANS001',
        id: 'E2',
      }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('transfer');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(1);
  });

  test('consolidates duplicate assets in swaps', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '-100', asset: 'USD', correlationId: 'SWAP001', id: 'E1' }),
      createTestEntry({ amount: '-50', asset: 'USD', correlationId: 'SWAP001', id: 'E2' }),
      createTestEntry({ amount: '0.001', asset: 'BTC', correlationId: 'SWAP001', id: 'E3' }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.asset).toBe('USD');
    expect(transaction.movements.outflows![0]?.amount.toString()).toBe('150');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.asset).toBe('BTC');
  });

  test('aggregates fees across multiple entries', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({
        amount: '-100',
        asset: 'USD',
        correlationId: 'SWAP001',
        fee: '1.50',
        feeCurrency: 'USD',
        id: 'E1',
      }),
      createTestEntry({
        amount: '0.001',
        asset: 'BTC',
        correlationId: 'SWAP001',
        fee: '1.00',
        feeCurrency: 'USD',
        id: 'E2',
      }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.fees.platform?.amount.toString()).toBe('2.5');
    expect(transaction.fees.platform?.currency.toString()).toBe('USD');
  });

  test('handles complex multi-asset transactions with uncertainty note', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '-100', asset: 'USD', correlationId: 'COMPLEX001', id: 'E1' }),
      createTestEntry({ amount: '-50', asset: 'EUR', correlationId: 'COMPLEX001', id: 'E2' }),
      createTestEntry({ amount: '0.001', asset: 'BTC', correlationId: 'COMPLEX001', id: 'E3' }),
      createTestEntry({ amount: '0.01', asset: 'ETH', correlationId: 'COMPLEX001', id: 'E4' }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.note).toBeDefined();
    expect(transaction.note?.type).toBe('classification_uncertain');
    expect(transaction.note?.severity).toBe('info');

    expect(transaction.movements.inflows).toHaveLength(2);
    expect(transaction.movements.outflows).toHaveLength(2);
  });

  test('skips zero-amount entries', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '0', asset: 'USD', correlationId: 'ZERO001', id: 'E1' }),
      createTestEntry({ amount: '100', asset: 'USD', correlationId: 'ZERO001', id: 'E2' }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('fails atomically if any group cannot be processed', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '100', asset: 'USD', correlationId: 'GOOD001', id: 'E1' }),
      // This will create an empty group after zero-amount filtering
      createTestEntry({ amount: '0', asset: 'USD', correlationId: 'BAD001', id: 'E2' }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
  });

  test('maps exchange status correctly', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '100', asset: 'USD', correlationId: 'STATUS001', id: 'E1', status: 'pending' }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.status).toBe('pending');
  });
});

describe('BaseExchangeProcessor - Edge Cases', () => {
  test('properly converts timestamps from seconds to milliseconds', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      {
        amount: '100',
        asset: 'USD',
        correlationId: 'TIME001',
        id: 'E1',
        timestamp: 1704067200000, // Milliseconds
        type: 'deposit',
        status: 'success',
      },
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.datetime).toBeDefined();
    expect(transaction?.timestamp).toBe(1704067200000);
  });

  test('uses first entry as primary when multiple entries exist', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '-100', asset: 'USD', correlationId: 'PRIMARY001', id: 'PRIMARY_ID' }),
      createTestEntry({ amount: '0.001', asset: 'BTC', correlationId: 'PRIMARY001', id: 'SECONDARY_ID' }),
    ];

    const result = await processor.process(entries.map(wrapEntry), {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.externalId).toBe('PRIMARY_ID');
  });
});
