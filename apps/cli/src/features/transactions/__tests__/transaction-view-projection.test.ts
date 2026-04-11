import type { Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { toTransactionViewItem } from '../transaction-view-projection.js';

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    accountId: 1,
    txFingerprint: 'coinbase:trade:swap-1',
    datetime: '2024-11-13T03:27:00.000Z',
    timestamp: Date.parse('2024-11-13T03:27:00.000Z'),
    platformKey: 'coinbase',
    platformKind: 'exchange',
    status: 'success',
    operation: { category: 'trade', type: 'swap' },
    movements: {
      inflows: [
        {
          assetId: 'asset:btc',
          assetSymbol: 'BTC' as Currency,
          movementFingerprint: 'inflow:btc:1',
          grossAmount: parseDecimal('0.0035'),
          netAmount: parseDecimal('0.0035'),
        },
      ],
      outflows: [
        {
          assetId: 'asset:cad',
          assetSymbol: 'CAD' as Currency,
          movementFingerprint: 'outflow:cad:1',
          grossAmount: parseDecimal('250'),
          netAmount: parseDecimal('250'),
        },
      ],
    },
    fees: [],
    notes: [],
    ...overrides,
  };
}

describe('toTransactionViewItem', () => {
  it('includes sent and received summaries for two-sided trades', () => {
    const item = toTransactionViewItem(createTransaction());

    expect(item.sentSummary).toBe('250 CAD');
    expect(item.receivedSummary).toBe('0.0035 BTC');
    expect(item.primaryAsset).toBe('CAD');
    expect(item.primaryDirection).toBe('out');
  });

  it('aggregates repeated assets into side summaries', () => {
    const item = toTransactionViewItem(
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              movementFingerprint: 'inflow:btc:1',
              grossAmount: parseDecimal('0.002'),
              netAmount: parseDecimal('0.002'),
            },
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              movementFingerprint: 'inflow:btc:2',
              grossAmount: parseDecimal('0.0015'),
              netAmount: parseDecimal('0.0015'),
            },
          ],
          outflows: [
            {
              assetId: 'asset:cad',
              assetSymbol: 'CAD' as Currency,
              movementFingerprint: 'outflow:cad:1',
              grossAmount: parseDecimal('100'),
              netAmount: parseDecimal('100'),
            },
            {
              assetId: 'asset:cad',
              assetSymbol: 'CAD' as Currency,
              movementFingerprint: 'outflow:cad:2',
              grossAmount: parseDecimal('150'),
              netAmount: parseDecimal('150'),
            },
          ],
        },
      })
    );

    expect(item.sentSummary).toBe('250 CAD');
    expect(item.receivedSummary).toBe('0.0035 BTC');
  });
});
