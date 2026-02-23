import type { Currency } from '@exitbook/core';
import type { CoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import { coinbaseGrossAmounts, type LedgerEntryWithRaw } from '../strategies/index.js';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function buildEntry(
  overrides?: DeepPartial<LedgerEntryWithRaw<CoinbaseLedgerEntry>>
): LedgerEntryWithRaw<CoinbaseLedgerEntry> {
  const timestamp = 1_722_461_782_000;
  const base: LedgerEntryWithRaw<CoinbaseLedgerEntry> = {
    eventId: 'entry-1',
    cursor: {},
    normalized: {
      id: 'entry-1',
      correlationId: 'corr-1',
      timestamp,
      type: 'advanced_trade_fill',
      assetSymbol: 'USDC' as Currency,
      amount: '61.902',
      status: 'success',
    },
    raw: {
      id: 'entry-1',
      direction: 'in',
      account: 'account-1',
      type: 'advanced_trade_fill',
      currency: 'USDC',
      amount: '61.902', // DecimalStringSchema expects string
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      status: 'ok',
    },
  };

  const merged = {
    ...base,
    ...(overrides || {}),
  };

  return {
    ...merged,
    normalized: {
      ...base.normalized,
      ...(overrides?.normalized || {}),
    },
    raw: {
      ...base.raw,
      ...(overrides?.raw || {}),
    },
  } as LedgerEntryWithRaw<CoinbaseLedgerEntry>;
}

describe('coinbaseGrossAmounts', () => {
  test('keeps gross amounts untouched even when fee uses the same asset', () => {
    const entry = buildEntry({
      normalized: {
        fee: '0.371412',
        feeCurrency: 'USDC' as Currency,
      },
    });

    const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

    expect(result.inflows).toHaveLength(1);
    expect(result.inflows[0]?.grossAmount).toBe('61.902');
    expect(result.inflows[0]?.netAmount).toBe('61.902');
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0]?.amount).toBe('0.371412');
  });

  test('leaves gross amount unchanged when fee currency differs', () => {
    const entry = buildEntry({
      normalized: {
        fee: '0.5',
        feeCurrency: 'USDT' as Currency,
      },
      raw: {
        currency: 'USDC',
      },
    });

    const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

    expect(result.inflows).toHaveLength(1);
    expect(result.inflows[0]?.grossAmount).toBe('61.902');
    expect(result.inflows[0]?.netAmount).toBe('61.902');
    expect(result.fees[0]?.amount).toBe('0.5');
  });
});
