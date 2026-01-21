import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { calculateBalances } from '../balance-calculator.js';

// Helper function to create a base test transaction with all required fields
function createTestTransaction(overrides: Partial<UniversalTransactionData>): UniversalTransactionData {
  return {
    id: 1,
    accountId: 1,
    source: 'test',
    sourceType: 'exchange',
    externalId: 'test-tx',
    status: 'success',
    datetime: '2024-01-01T00:00:00Z',
    timestamp: Date.parse(overrides.datetime ?? '2024-01-01T00:00:00Z'),
    operation: { category: 'transfer', type: 'transfer' }, // Provide a default operation; adjust as needed for your tests
    movements: { inflows: [], outflows: [] },
    fees: [],
    ...overrides,
  };
}

describe('calculateBalances', () => {
  it('should return empty balances for empty transactions array', () => {
    const result = calculateBalances([]);

    expect(result.balances).toEqual({});
    expect(result.assetMetadata).toEqual({});
  });

  it('should calculate balance from single inflow transaction', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx1',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.5'),
            netAmount: parseDecimal('1.5'),
          },
        ],
        outflows: [],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:btc']).toBeDefined();
    expect(result.balances['test:btc']?.toString()).toBe('1.5');
    expect(result.assetMetadata['test:btc']).toBe('BTC');
  });

  it('should calculate balance from single outflow transaction', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx2',
      movements: {
        inflows: [],
        outflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH',
            grossAmount: parseDecimal('2.0'),
            netAmount: parseDecimal('2.0'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:eth']).toBeDefined();
    expect(result.balances['test:eth']?.toString()).toBe('-2');
  });

  it('should calculate balance with network fees', () => {
    // Bitcoin (UTXO chain): fee is included in grossAmount
    // grossAmount = inputs - change = fee is embedded in the balance impact
    const transaction = createTestTransaction({
      source: 'bitcoin',
      externalId: 'tx3',
      from: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      movements: {
        outflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.5001'), // Includes the 0.0001 fee
            netAmount: parseDecimal('0.5'), // What actually transferred
          },
        ],
      },
      fees: [
        {
          assetId: 'test:btc',
          assetSymbol: 'BTC',
          amount: parseDecimal('0.0001'),
          scope: 'network',
          settlement: 'on-chain',
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:btc']).toBeDefined();
    expect(result.balances['test:btc']?.toString()).toBe('-0.5001');
  });

  it('should calculate balance with platform fees', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx4',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
          },
        ],
        outflows: [
          {
            assetId: 'test:usdt',
            assetSymbol: 'USDT',
            grossAmount: parseDecimal('50000'),
            netAmount: parseDecimal('50000'),
          },
        ],
      },
      fees: [
        {
          assetId: 'test:btc',
          assetSymbol: 'BTC',
          amount: parseDecimal('0.001'),
          scope: 'platform',
          settlement: 'balance',
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:btc']).toBeDefined();
    expect(result.balances['test:btc']?.toString()).toBe('0.999');
    expect(result.balances['test:usdt']).toBeDefined();
    expect(result.balances['test:usdt']?.toString()).toBe('-50000');
  });

  it('should calculate balance with both network and platform fees', () => {
    // Ethereum (account-based chain): gas fees are paid separately from balance
    // Both network and platform fees use settlement='balance'
    const transaction = createTestTransaction({
      source: 'ethereum',
      externalId: 'tx5',
      from: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      to: '0x123456789abcdef123456789abcdef123456789a',
      movements: {
        outflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH',
            grossAmount: parseDecimal('5.0'), // Recipient receives full amount
            netAmount: parseDecimal('5.0'), // Same as gross for account-based chains
          },
        ],
      },
      fees: [
        {
          assetId: 'test:eth',
          assetSymbol: 'ETH',
          amount: parseDecimal('0.005'),
          scope: 'network',
          settlement: 'balance',
        },
        {
          assetId: 'test:eth',
          assetSymbol: 'ETH',
          amount: parseDecimal('0.001'),
          scope: 'platform',
          settlement: 'balance',
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:eth']).toBeDefined();
    expect(result.balances['test:eth']?.toString()).toBe('-5.006');
  });

  it('should aggregate balances across multiple transactions', () => {
    const transactions: UniversalTransactionData[] = [
      createTestTransaction({
        source: 'kraken',
        externalId: 'tx6',
        datetime: '2024-01-01T00:00:00Z',
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
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
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('0.5'),
              netAmount: parseDecimal('0.5'),
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
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('0.3'),
              netAmount: parseDecimal('0.3'),
            },
          ],
        },
        fees: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            amount: parseDecimal('0.001'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      }),
    ];

    const result = calculateBalances(transactions);

    expect(result.balances['test:btc']).toBeDefined();
    expect(result.balances['test:btc']?.toString()).toBe('1.199');
  });

  it('should handle multiple currencies in one transaction', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx9',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.5'),
            netAmount: parseDecimal('0.5'),
          },
        ],
        outflows: [
          {
            assetId: 'test:usdt',
            assetSymbol: 'USDT',
            grossAmount: parseDecimal('25000'),
            netAmount: parseDecimal('25000'),
          },
        ],
      },
      fees: [
        {
          assetId: 'test:usdt',
          assetSymbol: 'USDT',
          amount: parseDecimal('10'),
          scope: 'platform',
          settlement: 'balance',
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:btc']).toBeDefined();
    expect(result.balances['test:btc']?.toString()).toBe('0.5');
    expect(result.balances['test:usdt']).toBeDefined();
    expect(result.balances['test:usdt']?.toString()).toBe('-25010');
  });

  it('should handle transactions with null/empty movement fields', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx10',
    });

    const result = calculateBalances([transaction]);

    expect(result.balances).toEqual({});
    expect(result.assetMetadata).toEqual({});
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
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.00000001'),
            netAmount: parseDecimal('0.00000001'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:btc']).toBeDefined();
    expect(result.balances['test:btc']?.toString()).toBe('1e-8');
  });

  it('should handle very large amounts', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx13',
      movements: {
        inflows: [
          {
            assetId: 'test:shib',
            assetSymbol: 'SHIB',
            grossAmount: parseDecimal('1000000000000'),
            netAmount: parseDecimal('1000000000000'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:shib']).toBeDefined();
    expect(result.balances['test:shib']?.toString()).toBe('1000000000000');
  });

  it('should handle multiple inflows for same asset', () => {
    const transaction = createTestTransaction({
      source: 'kraken',
      externalId: 'tx14',
      movements: {
        inflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('1.0'),
          },
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH',
            grossAmount: parseDecimal('2.5'),
            netAmount: parseDecimal('2.5'),
          },
        ],
      },
    });

    const result = calculateBalances([transaction]);

    expect(result.balances['test:eth']).toBeDefined();
    expect(result.balances['test:eth']?.toString()).toBe('3.5');
  });

  it('should result in zero balance when inflows equal outflows plus fees', () => {
    const transactions: UniversalTransactionData[] = [
      createTestTransaction({
        source: 'kraken',
        externalId: 'tx15',
        datetime: '2024-01-01T00:00:00Z',
        movements: {
          inflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
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
              assetId: 'test:btc',
              assetSymbol: 'BTC',
              grossAmount: parseDecimal('0.999'),
              netAmount: parseDecimal('0.999'),
            },
          ],
        },
        fees: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            amount: parseDecimal('0.001'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
      }),
    ];

    const result = calculateBalances(transactions);

    expect(result.balances['test:btc']).toBeDefined();
    expect(result.balances['test:btc']?.toString()).toBe('0');
  });
});
