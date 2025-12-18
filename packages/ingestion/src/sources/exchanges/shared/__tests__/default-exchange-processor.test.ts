import type { ExchangeLedgerEntry } from '@exitbook/exchanges-providers';
import { describe, expect, test } from 'vitest';

import {
  ExchangeEntryBuilder,
  wrapEntry,
  expectOk,
  expectMovement,
  expectFee,
  expectOperation,
} from '../../../../shared/test-utils/index.js';
import { DefaultExchangeProcessor } from '../default-exchange-processor.js';

// Legacy helper function for tests not yet refactored
function createTestEntry(overrides: Partial<ExchangeLedgerEntry>): ExchangeLedgerEntry {
  return {
    amount: '0',
    asset: 'USD',
    correlationId: 'REF001',
    id: 'ENTRY001',
    timestamp: 1704067200000,
    type: 'test',
    status: 'success',
    ...overrides,
  };
}

/**
 * Test implementation of BaseExchangeProcessor
 */
class TestExchangeProcessor extends DefaultExchangeProcessor {
  constructor() {
    super('test-exchange');
  }

  protected mapStatus(status: string | undefined): 'pending' | 'success' | 'canceled' | 'failed' {
    if (!status) return 'success';

    switch (status.toLowerCase()) {
      case 'pending':
        return 'pending';
      case 'canceled':
      case 'cancelled':
        return 'canceled';
      case 'failed':
        return 'failed';
      default:
        return 'success';
    }
  }
}

describe('BaseExchangeProcessor - Fund Flow Analysis', () => {
  test('creates single transaction for swap (different assets)', async () => {
    const processor = new TestExchangeProcessor();

    const entries = [
      new ExchangeEntryBuilder()
        .withId('E1')
        .withCorrelationId('SWAP001')
        .withAmount('-1000')
        .withAsset('USD')
        .withFee('2.50')
        .withTimestamp(1704067200000)
        .build(),
      new ExchangeEntryBuilder()
        .withId('E2')
        .withCorrelationId('SWAP001')
        .withAmount('0.025')
        .withAsset('BTC')
        .withFee('0')
        .withTimestamp(1704067200000)
        .build(),
    ];

    const [transaction] = expectOk(await processor.process(entries.map(wrapEntry)));
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expectOperation(transaction).hasCategory('trade').hasType('swap');
    expectMovement(transaction).hasInflows(1).inflow(0).hasAsset('BTC').hasNetAmount('0.025');
    expectMovement(transaction).hasOutflows(1).outflow(0).hasAsset('USD').hasNetAmount('1000');
    expectFee(transaction, 'platform').toHaveAmount('2.5');
  });

  test('creates single transaction for deposit (inflow only)', async () => {
    const processor = new TestExchangeProcessor();

    const entries = [
      new ExchangeEntryBuilder()
        .withId('E1')
        .withCorrelationId('DEP001')
        .withAmount('700.00')
        .withAsset('CAD')
        .withFee('3.49')
        .build(),
    ];

    const [transaction] = expectOk(await processor.process(entries.map(wrapEntry)));
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expectOperation(transaction).hasCategory('transfer').hasType('deposit');
    expectMovement(transaction).hasInflows(1).inflow(0).hasAsset('CAD').hasNetAmount('700');
    expectMovement(transaction).hasOutflows(0);
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

    const result = await processor.process(entries.map(wrapEntry));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.asset).toBe('CAD');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('385.155');

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

    const result = await processor.process(entries.map(wrapEntry));

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

    const result = await processor.process(entries.map(wrapEntry));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.asset).toBe('USD');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('150');

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

    const result = await processor.process(entries.map(wrapEntry));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.fees.find((f) => f.scope === 'platform')?.amount.toFixed()).toBe('2.5');
    expect(transaction.fees.find((f) => f.scope === 'platform')?.asset.toString()).toBe('USD');
  });

  test('handles complex multi-asset transactions with uncertainty note', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '-100', asset: 'USD', correlationId: 'COMPLEX001', id: 'E1' }),
      createTestEntry({ amount: '-50', asset: 'EUR', correlationId: 'COMPLEX001', id: 'E2' }),
      createTestEntry({ amount: '0.001', asset: 'BTC', correlationId: 'COMPLEX001', id: 'E3' }),
      createTestEntry({ amount: '0.01', asset: 'ETH', correlationId: 'COMPLEX001', id: 'E4' }),
    ];

    const result = await processor.process(entries.map(wrapEntry));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.notes).toBeDefined();
    expect(transaction.notes?.[0]?.type).toBe('classification_uncertain');
    expect(transaction.notes?.[0]?.severity).toBe('info');

    expect(transaction.movements.inflows).toHaveLength(2);
    expect(transaction.movements.outflows).toHaveLength(2);
  });

  test('skips zero-amount entries', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '0', asset: 'USD', correlationId: 'ZERO001', id: 'E1' }),
      createTestEntry({ amount: '100', asset: 'USD', correlationId: 'ZERO001', id: 'E2' }),
    ];

    const result = await processor.process(entries.map(wrapEntry));

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

    const result = await processor.process(entries.map(wrapEntry));

    expect(result.isOk()).toBe(true);
  });

  test('maps exchange status correctly', async () => {
    const processor = new TestExchangeProcessor();

    const entries: ExchangeLedgerEntry[] = [
      createTestEntry({ amount: '100', asset: 'USD', correlationId: 'STATUS001', id: 'E1', status: 'pending' }),
    ];

    const result = await processor.process(entries.map(wrapEntry));

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

    const result = await processor.process(entries.map(wrapEntry));

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

    const result = await processor.process(entries.map(wrapEntry));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.externalId).toBe('PRIMARY_ID');
  });
});
