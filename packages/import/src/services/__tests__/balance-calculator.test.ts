/* eslint-disable unicorn/no-null -- Acceptable for tests */
import { createMoney, parseDecimal } from '@exitbook/core';
import type { StoredTransaction } from '@exitbook/data';
import { describe, expect, it } from 'vitest';

import { calculateBalances } from '../balance-calculator.ts';

// Helper function to create a base test transaction with all required fields
function createTestTransaction(overrides: Partial<StoredTransaction>): StoredTransaction {
  return {
    id: 1,
    import_session_id: 1,
    source_id: 'test',
    source_type: 'exchange',
    external_id: 'test-tx',
    transaction_status: 'success',
    transaction_datetime: '2024-01-01T00:00:00Z',
    from_address: null,
    to_address: null,
    verified: false,
    price: null,
    price_currency: null,
    note_type: null,
    note_severity: null,
    note_message: null,
    note_metadata: null,
    raw_normalized_data: null,
    movements_inflows: [],
    movements_outflows: [],
    fees_network: null,
    fees_platform: null,
    fees_total: null,
    operation_category: null,
    operation_type: null,
    blockchain_name: null,
    blockchain_block_height: null,
    blockchain_transaction_hash: null,
    blockchain_is_confirmed: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
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
      id: 1,
      source_id: 'kraken',
      external_id: 'tx1',
      movements_inflows: [
        {
          asset: 'BTC',
          amount: parseDecimal('1.5'),
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('1.5');
  });

  it('should calculate balance from single outflow transaction', () => {
    const transaction = createTestTransaction({
      id: 2,
      source_id: 'kraken',
      external_id: 'tx2',
      movements_outflows: [
        {
          asset: 'ETH',
          amount: parseDecimal('2.0'),
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.ETH).toBeDefined();
    expect(result.ETH?.toString()).toBe('-2');
  });

  it('should calculate balance with network fees', () => {
    const transaction = createTestTransaction({
      id: 3,
      source_id: 'bitcoin',
      source_type: 'blockchain',
      external_id: 'tx3',
      from_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      to_address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      movements_outflows: [
        {
          asset: 'BTC',
          amount: parseDecimal('0.5'),
        },
      ],
      fees_network: createMoney('0.0001', 'BTC'),
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('-0.5001');
  });

  it('should calculate balance with platform fees', () => {
    const transaction = createTestTransaction({
      id: 4,
      source_id: 'kraken',
      external_id: 'tx4',
      movements_inflows: [
        {
          asset: 'BTC',
          amount: parseDecimal('1.0'),
        },
      ],
      movements_outflows: [
        {
          asset: 'USDT',
          amount: parseDecimal('50000'),
        },
      ],
      fees_platform: createMoney('0.001', 'BTC'),
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('0.999');
    expect(result.USDT).toBeDefined();
    expect(result.USDT?.toString()).toBe('-50000');
  });

  it('should calculate balance with both network and platform fees', () => {
    const transaction = createTestTransaction({
      id: 5,
      source_id: 'ethereum',
      source_type: 'blockchain',
      external_id: 'tx5',
      from_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      to_address: '0x123456789abcdef123456789abcdef123456789a',
      movements_outflows: [
        {
          asset: 'ETH',
          amount: parseDecimal('5.0'),
        },
      ],
      fees_network: createMoney('0.005', 'ETH'),
      fees_platform: createMoney('0.001', 'ETH'),
    });

    const result = calculateBalances([transaction]);

    expect(result.ETH).toBeDefined();
    expect(result.ETH?.toString()).toBe('-5.006');
  });

  it('should aggregate balances across multiple transactions', () => {
    const transactions: StoredTransaction[] = [
      createTestTransaction({
        id: 6,
        source_id: 'kraken',
        external_id: 'tx6',
        transaction_datetime: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        movements_inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('1.0'),
          },
        ],
      }),
      createTestTransaction({
        id: 7,
        source_id: 'kraken',
        external_id: 'tx7',
        transaction_datetime: '2024-01-02T00:00:00Z',
        created_at: '2024-01-02T00:00:00Z',
        movements_inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.5'),
          },
        ],
      }),
      createTestTransaction({
        id: 8,
        source_id: 'kraken',
        external_id: 'tx8',
        transaction_datetime: '2024-01-03T00:00:00Z',
        created_at: '2024-01-03T00:00:00Z',
        movements_outflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.3'),
          },
        ],
        fees_platform: createMoney('0.001', 'BTC'),
      }),
    ];

    const result = calculateBalances(transactions);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('1.199');
  });

  it('should handle multiple currencies in one transaction', () => {
    const transaction = createTestTransaction({
      id: 9,
      source_id: 'kraken',
      external_id: 'tx9',
      movements_inflows: [
        {
          asset: 'BTC',
          amount: parseDecimal('0.5'),
        },
      ],
      movements_outflows: [
        {
          asset: 'USDT',
          amount: parseDecimal('25000'),
        },
      ],
      fees_platform: createMoney('10', 'USDT'),
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('0.5');
    expect(result.USDT).toBeDefined();
    expect(result.USDT?.toString()).toBe('-25010');
  });

  it('should handle transactions with null/empty movement fields', () => {
    const transaction = createTestTransaction({
      id: 10,
      source_id: 'kraken',
      external_id: 'tx10',
    });

    const result = calculateBalances([transaction]);

    expect(result).toEqual({});
  });

  it('should handle very small decimal amounts', () => {
    const transaction = createTestTransaction({
      id: 12,
      source_id: 'bitcoin',
      source_type: 'blockchain',
      external_id: 'tx12',
      from_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      to_address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      movements_inflows: [
        {
          asset: 'BTC',
          amount: parseDecimal('0.00000001'),
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('1e-8');
  });

  it('should handle very large amounts', () => {
    const transaction = createTestTransaction({
      id: 13,
      source_id: 'kraken',
      external_id: 'tx13',
      movements_inflows: [
        {
          asset: 'SHIB',
          amount: parseDecimal('1000000000000'),
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.SHIB).toBeDefined();
    expect(result.SHIB?.toString()).toBe('1000000000000');
  });

  it('should handle multiple inflows for same asset', () => {
    const transaction = createTestTransaction({
      id: 14,
      source_id: 'kraken',
      external_id: 'tx14',
      movements_inflows: [
        {
          asset: 'ETH',
          amount: parseDecimal('1.0'),
        },
        {
          asset: 'ETH',
          amount: parseDecimal('2.5'),
        },
      ],
    });

    const result = calculateBalances([transaction]);

    expect(result.ETH).toBeDefined();
    expect(result.ETH?.toString()).toBe('3.5');
  });

  it('should result in zero balance when inflows equal outflows plus fees', () => {
    const transactions: StoredTransaction[] = [
      createTestTransaction({
        id: 15,
        source_id: 'kraken',
        external_id: 'tx15',
        transaction_datetime: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        movements_inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('1.0'),
          },
        ],
      }),
      createTestTransaction({
        id: 16,
        source_id: 'kraken',
        external_id: 'tx16',
        transaction_datetime: '2024-01-02T00:00:00Z',
        created_at: '2024-01-02T00:00:00Z',
        movements_outflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('0.999'),
          },
        ],
        fees_platform: createMoney('0.001', 'BTC'),
      }),
    ];

    const result = calculateBalances(transactions);

    expect(result.BTC).toBeDefined();
    expect(result.BTC?.toString()).toBe('0');
  });
});
