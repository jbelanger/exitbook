import type { Currency } from '@exitbook/core';
import type { ExchangeLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import type { LedgerEntryWithRaw } from '../grouping.js';
import { standardAmounts } from '../interpretation.js';

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

describe('InterpretationStrategy - standardAmounts', () => {
  test('interprets positive amount as inflow', () => {
    const entry = wrapEntry(createEntry({ amount: '100', assetSymbol: 'USD' as Currency }));

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.inflows).toHaveLength(1);
    expect(result.inflows[0]).toEqual({
      assetId: 'exchange:test:usd',
      assetSymbol: 'USD' as Currency,
      grossAmount: '100',
      netAmount: '100',
    });
    expect(result.outflows).toHaveLength(0);
    expect(result.fees).toHaveLength(0);
  });

  test('interprets negative amount as outflow', () => {
    const entry = wrapEntry(createEntry({ amount: '-100', assetSymbol: 'USD' as Currency }));

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.inflows).toHaveLength(0);
    expect(result.outflows).toHaveLength(1);
    expect(result.outflows[0]).toEqual({
      assetId: 'exchange:test:usd',
      assetSymbol: 'USD' as Currency,
      grossAmount: '100',
      netAmount: '100',
    });
    expect(result.fees).toHaveLength(0);
  });

  test('interprets zero amount as no movement (actually produces inflow of 0 in standard strategy)', () => {
    const entry = wrapEntry(createEntry({ amount: '0', assetSymbol: 'USD' as Currency }));

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    // Note: standardAmounts returns inflow with '0' amount when amount is exactly zero
    // This is by design - the processor filters zeros later
    expect(result.inflows).toHaveLength(1);
    expect(result.inflows[0]?.grossAmount).toBe('0');
    expect(result.outflows).toHaveLength(0);
    expect(result.fees).toHaveLength(0);
  });

  test('extracts fee when present', () => {
    const entry = wrapEntry(
      createEntry({ amount: '100', assetSymbol: 'USD' as Currency, fee: '2.50', feeCurrency: 'USD' as Currency })
    );

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.fees).toHaveLength(1);
    expect(result.fees[0]).toEqual({
      assetId: 'exchange:test:usd',
      amount: '2.5',
      assetSymbol: 'USD' as Currency,
      scope: 'platform',
      settlement: 'balance',
    });
  });

  test('uses asset as default fee currency when feeCurrency not specified', () => {
    const entry = wrapEntry(createEntry({ amount: '100', assetSymbol: 'BTC' as Currency, fee: '0.001' }));

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.fees).toHaveLength(1);
    expect(result.fees[0]).toEqual({
      assetId: 'exchange:test:btc',
      amount: '0.001',
      assetSymbol: 'BTC' as Currency,
      scope: 'platform',
      settlement: 'balance',
    });
  });

  test('ignores zero fees', () => {
    const entry = wrapEntry(
      createEntry({ amount: '100', assetSymbol: 'USD' as Currency, fee: '0', feeCurrency: 'USD' as Currency })
    );

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.fees).toHaveLength(0);
  });

  test('handles decimal amounts correctly', () => {
    const entry = wrapEntry(createEntry({ amount: '0.00123456', assetSymbol: 'BTC' as Currency }));

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.inflows[0]?.grossAmount).toBe('0.00123456');
  });

  test('handles large amounts', () => {
    const entry = wrapEntry(createEntry({ amount: '1000000.50', assetSymbol: 'USD' as Currency }));

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.inflows[0]?.grossAmount).toBe('1000000.5');
  });

  test('handles negative decimal amounts', () => {
    const entry = wrapEntry(createEntry({ amount: '-0.00123456', assetSymbol: 'BTC' as Currency }));

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.outflows[0]?.grossAmount).toBe('0.00123456');
  });

  test('handles amounts with fees', () => {
    const entry = wrapEntry(
      createEntry({ amount: '-100', assetSymbol: 'USD' as Currency, fee: '1.50', feeCurrency: 'USD' as Currency })
    );

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.outflows[0]?.grossAmount).toBe('100');
    expect(result.fees[0]?.amount).toBe('1.5');
    expect(result.fees[0]?.assetSymbol).toBe('USD');
  });

  test('ignores group parameter for standard interpretation', () => {
    const entry1 = wrapEntry(createEntry({ id: 'E1', amount: '-100', assetSymbol: 'USD' as Currency }));
    const entry2 = wrapEntry(createEntry({ id: 'E2', amount: '0.001', assetSymbol: 'BTC' as Currency }));

    const result = standardAmounts.interpret(entry1, [entry1, entry2], 'test')._unsafeUnwrap();

    expect(result.outflows).toHaveLength(1);
    expect(result.outflows[0]?.grossAmount).toBe('100');
  });

  test('handles different currencies', () => {
    const eurEntry = wrapEntry(createEntry({ amount: '500', assetSymbol: 'EUR' as Currency }));
    const btcEntry = wrapEntry(createEntry({ amount: '0.5', assetSymbol: 'BTC' as Currency }));

    const eurResult = standardAmounts.interpret(eurEntry, [eurEntry], 'test')._unsafeUnwrap();
    const btcResult = standardAmounts.interpret(btcEntry, [btcEntry], 'test')._unsafeUnwrap();

    expect(eurResult.inflows[0]?.assetSymbol).toBe('EUR');
    expect(btcResult.inflows[0]?.assetSymbol).toBe('BTC');
  });

  test('handles fee in different currency than amount', () => {
    const entry = wrapEntry(
      createEntry({ amount: '0.1', assetSymbol: 'BTC' as Currency, fee: '5', feeCurrency: 'USD' as Currency })
    );

    const result = standardAmounts.interpret(entry, [entry], 'test')._unsafeUnwrap();

    expect(result.inflows[0]?.assetSymbol).toBe('BTC');
    expect(result.fees[0]?.assetSymbol).toBe('USD');
  });
});
