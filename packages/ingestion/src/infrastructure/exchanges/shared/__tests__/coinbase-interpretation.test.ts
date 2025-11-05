import type { CoinbaseLedgerEntry } from '@exitbook/exchanges';
import { describe, expect, test } from 'vitest';

import { coinbaseGrossAmounts, type RawTransactionWithMetadata } from '../strategies/index.ts';

function buildEntry(
  overrides: Partial<RawTransactionWithMetadata<CoinbaseLedgerEntry>>
): RawTransactionWithMetadata<CoinbaseLedgerEntry> {
  const timestamp = 1_722_461_782_000;
  const base: RawTransactionWithMetadata<CoinbaseLedgerEntry> = {
    externalId: 'entry-1',
    cursor: {},
    normalized: {
      id: 'entry-1',
      correlationId: 'corr-1',
      timestamp,
      type: 'advanced_trade_fill',
      asset: 'USDC',
      amount: '61.902',
      status: 'success',
    },
    raw: {
      id: 'entry-1',
      direction: 'in',
      account: 'account-1',
      type: 'advanced_trade_fill',
      currency: 'USDC',
      amount: 61.902,
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      status: 'ok',
    },
  };

  return {
    ...base,
    ...overrides,
    normalized: {
      ...base.normalized,
      ...overrides.normalized,
    },
    raw: {
      ...base.raw,
      ...overrides.raw,
    },
  };
}

describe('coinbaseGrossAmounts', () => {
  test('keeps gross amounts untouched even when fee uses the same asset', () => {
    const entry = buildEntry({
      normalized: {
        fee: '0.371412',
        feeCurrency: 'USDC',
      },
    });

    const result = coinbaseGrossAmounts.interpret(entry, [entry]);

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
        feeCurrency: 'USDT',
      },
      raw: {
        currency: 'USDC',
      },
    });

    const result = coinbaseGrossAmounts.interpret(entry, [entry]);

    expect(result.inflows).toHaveLength(1);
    expect(result.inflows[0]?.grossAmount).toBe('61.902');
    expect(result.inflows[0]?.netAmount).toBe('61.902');
    expect(result.fees[0]?.amount).toBe('0.5');
  });
});
