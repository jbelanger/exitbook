import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { calculateBalances } from '../balance-calculator.ts';

// Helper function to create a base test transaction with all required fields
function createTestTransaction(overrides: Partial<UniversalTransaction>): UniversalTransaction {
  return {
    id: 0, // Will be assigned by database
    source: 'test',
    externalId: 'test-tx',
    status: 'success',
    datetime: '2024-01-01T00:00:00Z',
    timestamp: Date.parse(overrides.datetime ?? '2024-01-01T00:00:00Z'),
    operation: { category: 'transfer', type: 'transfer' }, // Provide a default operation; adjust as needed for your tests
    movements: {},
    fees: {},
    ...overrides,
  };
}

describe('calculateBalances', () => {
  it('should return empty balances for empty transactions array', () => {
    const result = calculateBalances([]);

    expect(result).toEqual({});
  });

  it('should calculate balance from single inflow transaction', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx1',
      movements: {
        inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('1.5'),
          },
        ],
        outflows: [],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('1.5');
  });

  it('should calculate balance from single outflow transaction', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx2',
      movements: {
        inflows: [],
        outflows: [
          {
            asset: 'ETH',
            amount: parseDecimal('2.0'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.ETH).toBeDefined();
    expect(result.ETH?.toString()).toBe('-2');
  });

  it('should calculate balance with network fees', () => {
    const transaction = createTestTransaction({
      source: 'bitcoin',
      externalId: 'tx3',
      from: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      movements: {
        outflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.5'),
          },
        ],
      },
      fees: {
        network: { amount: parseDecimal('0.0001'), asset: 'BTC' },
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('-0.5001');
  });

  it('should calculate balance with platform fees', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx4',
      movements: {
        inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('1.0'),
          },
        ],
        outflows: [
          {
            asset: 'USDT',
            amount: parseDecimal('50000'),
          },
        ],
      },
      fees: { platform: { amount: parseDecimal('0.001'), asset: 'BTC' } },
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('0.999');
    expect(result.USDT).toBeDefined();
    expect(result.USDT?.toString()).toBe('-50000');
  });

  it('should calculate balance with both network and platform fees', () => {
    const transaction = createTestTransaction({
      source: 'ethereum',
      externalId: 'tx5',
      from: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      to: '0x123456789abcdef123456789abcdef123456789a',
      movements: {
        outflows: [
          {
            asset: 'ETH',
            amount: parseDecimal('5.0'),
          },
        ],
      },
      fees: {
        network: { amount: parseDecimal('0.005'), asset: 'ETH' },
        platform: { amount: parseDecimal('0.001'), asset: 'ETH' },
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.ETH).toBeDefined();
    expect(result.ETH?.toString()).toBe('-5.006');
  });

  it('should aggregate balances across multiple transactions', () => {
    const transactions: UniversalTransaction[] = [
      createTestTransaction({
        source: 'kraken',
        externalId: 'tx6',
        datetime: '2024-01-01T00:00:00Z',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('1.0'),
            },
          ],
        },
      }),
      createTestTransaction({
        source: 'kraken',
        externalId: 'tx7',
        datetime: '2024-01-02T00:00:00Z',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.5'),
            },
          ],
        },
      }),
      createTestTransaction({
        source: 'kraken',
        externalId: 'tx8',
        datetime: '2024-01-03T00:00:00Z',
        movements: {
          outflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.3'),
            },
          ],
        },
        fees: { platform: { amount: parseDecimal('0.001'), asset: 'BTC' } },
      }),
    ];

    const result = calculateBalances(transactions);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('1.199');
  });

  it('should handle multiple currencies in one transaction', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx9',
      movements: {
        inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.5'),
          },
        ],
        outflows: [
          {
            asset: 'USDT',
            amount: parseDecimal('25000'),
          },
        ],
      },
      fees: { platform: { amount: parseDecimal('10'), asset: 'USDT' } },
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('0.5');
    expect(result.USDT).toBeDefined();
    expect(result.USDT?.toString()).toBe('-25010');
  });

  it('should handle transactions with null/empty movement fields', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx10',
    });

    const result = calculateBalances([transaction]);

    expect(result).toEqual({});
  });

  it('should handle very small decimal amounts', () => {
    const transaction = createTestTransaction({
      source: 'bitcoin',
      externalId: 'tx12',
      from: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      movements: {
        inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.00000001'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('1e-8');
  });

  it('should handle very large amounts', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx13',
      movements: {
        inflows: [
          {
            asset: 'SHIB',
            amount: parseDecimal('1000000000000'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.SHIB).toBeDefined();
    expect(result.SHIB?.toString()).toBe('1000000000000');
  });

  it('should handle multiple inflows for same asset', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx14',
      movements: {
        inflows: [
          {
            asset: 'ETH',
            amount: parseDecimal('1.0'),
          },
          {
            asset: 'ETH',
            amount: parseDecimal('2.5'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.ETH).toBeDefined();
    expect(result.ETH?.toString()).toBe('3.5');
  });

  it('should result in zero balance when inflows equal outflows plus fees', () => {
    const transactions: UniversalTransaction[] = [
      createTestTransaction({
        source: 'kraken',
        externalId: 'tx15',
        datetime: '2024-01-01T00:00:00Z',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('1.0'),
            },
          ],
        },
      }),
      createTestTransaction({
        source: 'kraken',
        externalId: 'tx16',
        datetime: '2024-01-02T00:00:00Z',
        movements: {
          outflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.999'),
            },
          ],
        },
        fees: { platform: { amount: parseDecimal('0.001'), asset: 'BTC' } },
      }),
    ];

    const result = calculateBalances(transactions);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('0');
  });
});
