import type { Transaction, TransactionDraft } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { buildStoredBalanceAssetDiagnosticsSummary } from '../stored-balance-diagnostics.js';

import { createPersistedTransaction } from './transaction-test-utils.js';

function createTransaction(params: {
  datetime: string;
  fees?: TransactionDraft['fees'] | undefined;
  id: number;
  inflows?: TransactionDraft['movements']['inflows'] | undefined;
  outflows?: TransactionDraft['movements']['outflows'] | undefined;
}): Transaction {
  return createPersistedTransaction({
    id: params.id,
    accountId: 1,
    txFingerprint: `stored-balance-test-${params.id}`,
    datetime: params.datetime,
    timestamp: Date.parse(params.datetime),
    platformKey: 'kraken',
    platformKind: 'exchange',
    status: 'success',
    operation: { category: 'trade', type: 'swap' },
    movements: {
      inflows: params.inflows,
      outflows: params.outflows,
    },
    fees: params.fees,
    diagnostics: [],
    userNotes: [],
  });
}

describe('buildStoredBalanceAssetDiagnosticsSummary', () => {
  it('uses shared balance impact semantics for net totals', () => {
    const transactions = [
      createTransaction({
        id: 1,
        datetime: '2025-01-01T00:00:00.000Z',
        outflows: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.999'),
          },
        ],
        fees: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.001'),
            scope: 'network',
            settlement: 'on-chain',
          },
        ],
      }),
      createTransaction({
        id: 2,
        datetime: '2025-01-02T00:00:00.000Z',
        inflows: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.25'),
            netAmount: parseDecimal('0.25'),
          },
        ],
      }),
      createTransaction({
        id: 3,
        datetime: '2025-01-03T00:00:00.000Z',
        fees: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.01'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      }),
    ];

    const summary = buildStoredBalanceAssetDiagnosticsSummary({
      assetId: 'asset:btc',
      transactions,
    });

    expect(summary.assetSymbol).toBe('BTC');
    expect(summary.totals.inflows.toFixed()).toBe('0.25');
    expect(summary.totals.outflows.toFixed()).toBe('1');
    expect(summary.totals.fees.toFixed()).toBe('0.01');
    expect(summary.totals.net.toFixed()).toBe('-0.76');
    expect(summary.totals.txCount).toBe(3);
    expect(summary.dateRange).toEqual({
      earliest: '2025-01-01T00:00:00.000Z',
      latest: '2025-01-03T00:00:00.000Z',
    });
  });
});
