import type { ExchangeLedgerEntry } from '@exitbook/exchanges';
import { describe, expect, test } from 'vitest';

import type { RawTransactionWithMetadata } from '../grouping.ts';
import { standardAmounts } from '../interpretation.ts';

function createEntry(overrides: Partial<ExchangeLedgerEntry>): ExchangeLedgerEntry {
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

function wrapEntry(entry: ExchangeLedgerEntry): RawTransactionWithMetadata {
  return {
    raw: entry,
    normalized: entry,
    externalId: entry.id,
    cursor: {},
  };
}

describe('InterpretationStrategy - standardAmounts', () => {
  test('interprets positive amount as inflow', () => {
    const entry = wrapEntry(createEntry({ amount: '100', asset: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.inflows).toHaveLength(1);
    expect(result.inflows[0]).toEqual({ amount: '100', asset: 'USD' });
    expect(result.outflows).toHaveLength(0);
    expect(result.fees).toHaveLength(0);
  });

  test('interprets negative amount as outflow', () => {
    const entry = wrapEntry(createEntry({ amount: '-100', asset: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.inflows).toHaveLength(0);
    expect(result.outflows).toHaveLength(1);
    expect(result.outflows[0]).toEqual({ amount: '100', asset: 'USD' });
    expect(result.fees).toHaveLength(0);
  });

  test('interprets zero amount as no movement (actually produces inflow of 0 in standard strategy)', () => {
    const entry = wrapEntry(createEntry({ amount: '0', asset: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    // Note: standardAmounts returns inflow with '0' amount when amount is exactly zero
    // This is by design - the processor filters zeros later
    expect(result.inflows).toHaveLength(1);
    expect(result.inflows[0]?.amount).toBe('0');
    expect(result.outflows).toHaveLength(0);
    expect(result.fees).toHaveLength(0);
  });

  test('extracts fee when present', () => {
    const entry = wrapEntry(createEntry({ amount: '100', asset: 'USD', fee: '2.50', feeCurrency: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.fees).toHaveLength(1);
    expect(result.fees[0]).toEqual({ amount: '2.5', currency: 'USD' });
  });

  test('uses asset as default fee currency when feeCurrency not specified', () => {
    const entry = wrapEntry(createEntry({ amount: '100', asset: 'BTC', fee: '0.001' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.fees).toHaveLength(1);
    expect(result.fees[0]).toEqual({ amount: '0.001', currency: 'BTC' });
  });

  test('ignores zero fees', () => {
    const entry = wrapEntry(createEntry({ amount: '100', asset: 'USD', fee: '0', feeCurrency: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.fees).toHaveLength(0);
  });

  test('handles decimal amounts correctly', () => {
    const entry = wrapEntry(createEntry({ amount: '0.00123456', asset: 'BTC' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.inflows[0]?.amount).toBe('0.00123456');
  });

  test('handles large amounts', () => {
    const entry = wrapEntry(createEntry({ amount: '1000000.50', asset: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.inflows[0]?.amount).toBe('1000000.5');
  });

  test('handles negative decimal amounts', () => {
    const entry = wrapEntry(createEntry({ amount: '-0.00123456', asset: 'BTC' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.outflows[0]?.amount).toBe('0.00123456');
  });

  test('handles amounts with fees', () => {
    const entry = wrapEntry(createEntry({ amount: '-100', asset: 'USD', fee: '1.50', feeCurrency: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.outflows[0]?.amount).toBe('100');
    expect(result.fees[0]?.amount).toBe('1.5');
    expect(result.fees[0]?.currency).toBe('USD');
  });

  test('ignores group parameter for standard interpretation', () => {
    const entry1 = wrapEntry(createEntry({ id: 'E1', amount: '-100', asset: 'USD' }));
    const entry2 = wrapEntry(createEntry({ id: 'E2', amount: '0.001', asset: 'BTC' }));

    const result = standardAmounts.interpret(entry1, [entry1, entry2]);

    expect(result.outflows).toHaveLength(1);
    expect(result.outflows[0]?.amount).toBe('100');
  });

  test('handles different currencies', () => {
    const eurEntry = wrapEntry(createEntry({ amount: '500', asset: 'EUR' }));
    const btcEntry = wrapEntry(createEntry({ amount: '0.5', asset: 'BTC' }));

    const eurResult = standardAmounts.interpret(eurEntry, [eurEntry]);
    const btcResult = standardAmounts.interpret(btcEntry, [btcEntry]);

    expect(eurResult.inflows[0]?.asset).toBe('EUR');
    expect(btcResult.inflows[0]?.asset).toBe('BTC');
  });

  test('handles fee in different currency than amount', () => {
    const entry = wrapEntry(createEntry({ amount: '0.1', asset: 'BTC', fee: '5', feeCurrency: 'USD' }));

    const result = standardAmounts.interpret(entry, [entry]);

    expect(result.inflows[0]?.asset).toBe('BTC');
    expect(result.fees[0]?.currency).toBe('USD');
  });
});
