import type { Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { calculateBalances } from '../balance-calculation.js';

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    accountId: 1,
    txFingerprint: 'tx-1',
    datetime: '2026-01-01T00:00:00.000Z',
    timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
    platformKey: 'kraken',
    platformKind: 'exchange',
    status: 'success',
    operation: { category: 'trade', type: 'swap' },
    movements: {
      inflows: [],
      outflows: [],
    },
    fees: [],
    ...overrides,
  };
}

describe('calculateBalances', () => {
  it('does not subtract on-chain fees twice', () => {
    const result = calculateBalances([
      createTransaction({
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
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
            movementFingerprint: 'fee:btc:1',
            amount: parseDecimal('0.001'),
            scope: 'network',
            settlement: 'on-chain',
          },
        ],
      }),
    ]);

    expect(result.balances['asset:btc']?.toFixed()).toBe('-1');
    expect(result.assetMetadata['asset:btc']).toBe('BTC');
  });

  it('subtracts balance-settled fees as additional balance debits', () => {
    const result = calculateBalances([
      createTransaction({
        platformKey: 'ethereum',
        platformKind: 'blockchain',
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'asset:eth',
              assetSymbol: 'ETH' as Currency,
              movementFingerprint: 'outflow:eth:1',
              grossAmount: parseDecimal('2'),
              netAmount: parseDecimal('2'),
            },
          ],
        },
        fees: [
          {
            assetId: 'asset:eth',
            assetSymbol: 'ETH' as Currency,
            movementFingerprint: 'fee:eth:1',
            amount: parseDecimal('0.01'),
            scope: 'network',
            settlement: 'balance',
          },
        ],
      }),
    ]);

    expect(result.balances['asset:eth']?.toFixed()).toBe('-2.01');
  });

  it('keeps movement assets and separate fee assets reconciled independently', () => {
    const result = calculateBalances([
      createTransaction({
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
        fees: [
          {
            assetId: 'asset:usd',
            assetSymbol: 'USD' as Currency,
            movementFingerprint: 'fee:usd:1',
            amount: parseDecimal('5'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      }),
    ]);

    expect(result.balances['asset:btc']?.toFixed()).toBe('0.0035');
    expect(result.balances['asset:cad']?.toFixed()).toBe('-250');
    expect(result.balances['asset:usd']?.toFixed()).toBe('-5');
    expect(result.assetMetadata['asset:usd']).toBe('USD');
  });

  it('continues treating external fees as separate balance debits', () => {
    const result = calculateBalances([
      createTransaction({
        fees: [
          {
            assetId: 'asset:usd',
            assetSymbol: 'USD' as Currency,
            movementFingerprint: 'fee:usd:1',
            amount: parseDecimal('15'),
            scope: 'platform',
            settlement: 'external',
          },
        ],
      }),
    ]);

    expect(result.balances['asset:usd']?.toFixed()).toBe('-15');
  });
});
