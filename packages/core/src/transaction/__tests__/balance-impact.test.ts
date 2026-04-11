import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { buildTransactionBalanceImpact } from '../balance-impact.js';
import type { Transaction } from '../transaction.js';

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

describe('buildTransactionBalanceImpact', () => {
  it('records simple inflow credit and net delta', () => {
    const impact = buildTransactionBalanceImpact(
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              movementFingerprint: 'inflow:btc:1',
              grossAmount: parseDecimal('1.5'),
              netAmount: parseDecimal('1.5'),
            },
          ],
          outflows: [],
        },
      })
    );

    expect(impact.assets).toHaveLength(1);
    expect(impact.assets[0]?.assetId).toBe('asset:btc');
    expect(impact.assets[0]?.creditGross.toFixed()).toBe('1.5');
    expect(impact.assets[0]?.debitGross.toFixed()).toBe('0');
    expect(impact.assets[0]?.separateFeeDebit.toFixed()).toBe('0');
    expect(impact.assets[0]?.embeddedFeeAmount.toFixed()).toBe('0');
    expect(impact.assets[0]?.netBalanceDelta.toFixed()).toBe('1.5');
  });

  it('subtracts balance-settled fees as separate debits', () => {
    const impact = buildTransactionBalanceImpact(
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
      })
    );

    expect(impact.assets).toHaveLength(1);
    expect(impact.assets[0]?.debitGross.toFixed()).toBe('2');
    expect(impact.assets[0]?.separateFeeDebit.toFixed()).toBe('0.01');
    expect(impact.assets[0]?.embeddedFeeAmount.toFixed()).toBe('0');
    expect(impact.assets[0]?.netBalanceDelta.toFixed()).toBe('-2.01');
  });

  it('tracks on-chain fees without subtracting them twice from net balance', () => {
    const impact = buildTransactionBalanceImpact(
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
      })
    );

    expect(impact.assets).toHaveLength(1);
    expect(impact.assets[0]?.debitGross.toFixed()).toBe('1');
    expect(impact.assets[0]?.separateFeeDebit.toFixed()).toBe('0');
    expect(impact.assets[0]?.embeddedFeeAmount.toFixed()).toBe('0.001');
    expect(impact.assets[0]?.netBalanceDelta.toFixed()).toBe('-1');
  });

  it('keeps multi-asset movement and fee impacts separate by asset', () => {
    const impact = buildTransactionBalanceImpact(
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
            assetId: 'asset:cad',
            assetSymbol: 'CAD' as Currency,
            movementFingerprint: 'fee:cad:1',
            amount: parseDecimal('1.25'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      })
    );

    expect(impact.assets).toHaveLength(2);
    expect(impact.assets[0]?.assetId).toBe('asset:btc');
    expect(impact.assets[0]?.creditGross.toFixed()).toBe('0.0035');
    expect(impact.assets[0]?.netBalanceDelta.toFixed()).toBe('0.0035');
    expect(impact.assets[1]?.assetId).toBe('asset:cad');
    expect(impact.assets[1]?.debitGross.toFixed()).toBe('250');
    expect(impact.assets[1]?.separateFeeDebit.toFixed()).toBe('1.25');
    expect(impact.assets[1]?.netBalanceDelta.toFixed()).toBe('-251.25');
  });

  it('treats external fees as separate debits under current balance semantics', () => {
    const impact = buildTransactionBalanceImpact(
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
      })
    );

    expect(impact.assets).toHaveLength(1);
    expect(impact.assets[0]?.assetId).toBe('asset:usd');
    expect(impact.assets[0]?.separateFeeDebit.toFixed()).toBe('15');
    expect(impact.assets[0]?.netBalanceDelta.toFixed()).toBe('-15');
  });
});
