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
  it('includes debit and credit summaries for two-sided trades', () => {
    const item = toTransactionViewItem(createTransaction());

    expect(item.debitSummary).toBe('250 CAD');
    expect(item.creditSummary).toBe('0.0035 BTC');
    expect(item.feeSummary).toBeUndefined();
    expect(item.primaryMovementAsset).toBe('CAD');
    expect(item.primaryMovementDirection).toBe('out');
  });

  it('aggregates repeated assets into balance summaries', () => {
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

    expect(item.debitSummary).toBe('250 CAD');
    expect(item.creditSummary).toBe('0.0035 BTC');
  });

  it('includes only separate fee debits in the fee summary', () => {
    const item = toTransactionViewItem(
      createTransaction({
        fees: [
          {
            assetId: 'asset:cad',
            assetSymbol: 'CAD' as Currency,
            amount: parseDecimal('1.25'),
            scope: 'platform',
            settlement: 'balance',
            movementFingerprint: 'fee:cad:1',
          },
        ],
      })
    );

    expect(item.debitSummary).toBe('250 CAD');
    expect(item.creditSummary).toBe('0.0035 BTC');
    expect(item.feeSummary).toBe('1.25 CAD');
  });

  it('excludes on-chain fees from the separate fee summary', () => {
    const item = toTransactionViewItem(
      createTransaction({
        operation: { category: 'transfer', type: 'withdrawal' },
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              movementFingerprint: 'outflow:btc:1',
              grossAmount: parseDecimal('1'),
              netAmount: parseDecimal('0.999'),
            },
          ],
        },
        fees: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.001'),
            scope: 'network',
            settlement: 'on-chain',
            movementFingerprint: 'fee:btc:1',
          },
        ],
      })
    );

    expect(item.debitSummary).toBe('1 BTC');
    expect(item.creditSummary).toBeUndefined();
    expect(item.feeSummary).toBeUndefined();
  });
});
