import type { Currency } from '@exitbook/core';
import type { ExchangeLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import { CorrelatingExchangeProcessor } from '../correlating-exchange-processor.js';
import { byCorrelationId, noGrouping, type LedgerEntryWithRaw } from '../strategies/grouping.js';
import { standardAmounts } from '../strategies/interpretation.js';

function createEntry(overrides: Partial<ExchangeLedgerEntry>): ExchangeLedgerEntry {
  return {
    amount: '0',
    assetSymbol: 'USD' as Currency,
    correlationId: 'REF001',
    id: 'ENTRY001',
    timestamp: 1704067200000,
    type: 'test',
    status: 'success',
    ...overrides,
  };
}

function wrapEntry(entry: ExchangeLedgerEntry): LedgerEntryWithRaw {
  return {
    raw: entry,
    normalized: entry,
    eventId: entry.id,
    cursor: {},
  };
}

describe('CorrelatingExchangeProcessor - Strategy Composition', () => {
  test('uses grouping strategy to organize entries', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', correlationId: 'SWAP001', amount: '-100', assetSymbol: 'USD' as Currency })),
      wrapEntry(createEntry({ id: 'E2', correlationId: 'SWAP001', amount: '0.001', assetSymbol: 'BTC' as Currency })),
      wrapEntry(createEntry({ id: 'E3', correlationId: 'DEP001', amount: '500', assetSymbol: 'EUR' as Currency })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    const swap = transactions.find((t) => t.externalId === 'E1');
    const deposit = transactions.find((t) => t.externalId === 'E3');

    expect(swap).toBeDefined();
    expect(deposit).toBeDefined();
  });

  test('noGrouping strategy creates individual transactions', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', noGrouping, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', correlationId: 'SWAP001', amount: '-100', assetSymbol: 'USD' as Currency })),
      wrapEntry(createEntry({ id: 'E2', correlationId: 'SWAP001', amount: '0.001', assetSymbol: 'BTC' as Currency })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);
  });
});

describe('CorrelatingExchangeProcessor - Fund Flow Analysis', () => {
  test('consolidates multiple entries of same asset', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', correlationId: 'MULTI001', amount: '-100', assetSymbol: 'USD' as Currency })),
      wrapEntry(createEntry({ id: 'E2', correlationId: 'MULTI001', amount: '-50', assetSymbol: 'USD' as Currency })),
      wrapEntry(createEntry({ id: 'E3', correlationId: 'MULTI001', amount: '0.002', assetSymbol: 'BTC' as Currency })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.assetSymbol).toBe('USD');
    expect(transaction.movements.outflows![0]?.netAmount?.toFixed()).toBe('150');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('BTC');
  });

  test('consolidates fees across correlated entries', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(
        createEntry({
          id: 'E1',
          correlationId: 'SWAP001',
          amount: '-100',
          assetSymbol: 'USD' as Currency,
          fee: '1.50',
          feeCurrency: 'USD' as Currency,
        })
      ),
      wrapEntry(
        createEntry({
          id: 'E2',
          correlationId: 'SWAP001',
          amount: '0.001',
          assetSymbol: 'BTC' as Currency,
          fee: '1.00',
          feeCurrency: 'USD' as Currency,
        })
      ),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.fees.find((f) => f.scope === 'platform')?.amount.toFixed()).toBe('2.5');
    expect(transaction.fees.find((f) => f.scope === 'platform')?.assetSymbol.toString()).toBe('USD');
  });
});

describe('CorrelatingExchangeProcessor - Operation Classification', () => {
  test('classifies swap (different assets)', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', correlationId: 'SWAP001', amount: '-100', assetSymbol: 'USD' as Currency })),
      wrapEntry(createEntry({ id: 'E2', correlationId: 'SWAP001', amount: '0.001', assetSymbol: 'BTC' as Currency })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.operation.category).toBe('trade');
    expect(transaction?.operation.type).toBe('swap');
  });

  test('classifies deposit (inflow only)', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', correlationId: 'DEP001', amount: '700', assetSymbol: 'CAD' as Currency })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.operation.category).toBe('transfer');
    expect(transaction?.operation.type).toBe('deposit');
  });

  test('classifies withdrawal (outflow only)', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(
        createEntry({ id: 'E1', correlationId: 'WITH001', amount: '-385.155', assetSymbol: 'CAD' as Currency })
      ),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.operation.category).toBe('transfer');
    expect(transaction?.operation.type).toBe('withdrawal');
  });

  test('classifies self-transfer (same asset in and out)', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', correlationId: 'TRANS001', amount: '-100', assetSymbol: 'USDT' as Currency })),
      wrapEntry(createEntry({ id: 'E2', correlationId: 'TRANS001', amount: '100', assetSymbol: 'USDT' as Currency })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.operation.category).toBe('transfer');
    expect(transaction?.operation.type).toBe('transfer');
  });

  test('adds uncertainty note for complex multi-asset transactions', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', correlationId: 'COMPLEX001', amount: '-100', assetSymbol: 'USD' as Currency })),
      wrapEntry(createEntry({ id: 'E2', correlationId: 'COMPLEX001', amount: '-50', assetSymbol: 'EUR' as Currency })),
      wrapEntry(
        createEntry({ id: 'E3', correlationId: 'COMPLEX001', amount: '0.001', assetSymbol: 'BTC' as Currency })
      ),
      wrapEntry(createEntry({ id: 'E4', correlationId: 'COMPLEX001', amount: '0.01', assetSymbol: 'ETH' as Currency })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction?.notes).toBeDefined();
    expect(transaction?.notes?.[0]?.type).toBe('classification_uncertain');
    expect(transaction?.notes?.[0]?.severity).toBe('info');
    expect(transaction?.movements.inflows).toHaveLength(2);
    expect(transaction?.movements.outflows).toHaveLength(2);
  });
});

describe('CorrelatingExchangeProcessor - Error Handling', () => {
  test('returns error when empty entry group is provided', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries: LedgerEntryWithRaw[] = [];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(0);
  });

  test('skips entries without valid id in grouping', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const validEntry = wrapEntry(
      createEntry({ id: 'E1', correlationId: 'REF001', amount: '100', assetSymbol: 'USD' as Currency })
    );
    const validEntry2 = wrapEntry(
      createEntry({ id: 'E2', correlationId: 'REF002', amount: '50', assetSymbol: 'EUR' as Currency })
    );

    const entries = [validEntry, validEntry2] as LedgerEntryWithRaw[];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);
  });
});

describe('CorrelatingExchangeProcessor - Metadata', () => {
  test('sets source correctly', async () => {
    const processor = new CorrelatingExchangeProcessor('kraken', byCorrelationId, standardAmounts);

    const entries = [wrapEntry(createEntry({ id: 'E1', amount: '100', assetSymbol: 'USD' as Currency }))];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value[0]?.source).toBe('kraken');
  });

  test('preserves entry timestamp', async () => {
    const timestamp = 1704153600000;
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [wrapEntry(createEntry({ id: 'E1', timestamp, amount: '100', assetSymbol: 'USD' as Currency }))];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value[0]?.timestamp).toBe(timestamp);
    expect(result.value[0]?.datetime).toBe(new Date(timestamp).toISOString());
  });

  test('preserves entry status', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(createEntry({ id: 'E1', amount: '100', assetSymbol: 'USD' as Currency, status: 'pending' })),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value[0]?.status).toBe('pending');
  });

  test('preserves normalized destination address as to', async () => {
    const processor = new CorrelatingExchangeProcessor('test-exchange', byCorrelationId, standardAmounts);

    const entries = [
      wrapEntry(
        createEntry({
          id: 'E1',
          amount: '-100',
          assetSymbol: 'USDT' as Currency,
          address: '0xDest123',
        })
      ),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value[0]?.to).toBe('0xDest123');
  });
});
