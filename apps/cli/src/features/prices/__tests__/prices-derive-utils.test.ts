import { Currency, parseDecimal, type UniversalTransaction } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  countAllMovements,
  countMovementsWithoutPrices,
  countTransactionMovementsNeedingPrices,
  getNonFiatMovements,
  movementNeedsPrice,
} from '../prices-derive-utils.ts';

describe('countAllMovements', () => {
  it('should count all non-fiat movements across multiple transactions', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [{ asset: 'BTC', amount: parseDecimal('1') }],
          outflows: [{ asset: 'USD', amount: parseDecimal('50000') }],
        },
        fees: {},
      },
      {
        id: 2,
        datetime: '2024-01-16T12:00:00.000Z',
        timestamp: Date.parse('2024-01-16T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-2',
        operation: { category: 'trade', type: 'sell' },
        movements: {
          inflows: [{ asset: 'EUR', amount: parseDecimal('45000') }],
          outflows: [{ asset: 'ETH', amount: parseDecimal('10') }],
        },
        fees: {},
      },
    ];

    const count = countAllMovements(transactions);

    // Should count BTC (1) and ETH (1), excluding USD and EUR (fiat)
    expect(count).toBe(2);
  });

  it('should exclude all fiat currencies', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [
            { asset: 'USD', amount: parseDecimal('1000') },
            { asset: 'EUR', amount: parseDecimal('900') },
          ],
          outflows: [
            { asset: 'CAD', amount: parseDecimal('1300') },
            { asset: 'GBP', amount: parseDecimal('800') },
          ],
        },
        fees: {},
      },
    ];

    const count = countAllMovements(transactions);

    // All movements are fiat, should be 0
    expect(count).toBe(0);
  });

  it('should return 0 for empty transactions array', () => {
    const count = countAllMovements([]);

    expect(count).toBe(0);
  });

  it('should count movements regardless of having prices', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('1'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                source: 'coingecko',
                fetchedAt: new Date(),
              },
            },
          ],
          outflows: [{ asset: 'ETH', amount: parseDecimal('10') }],
        },
        fees: {},
      },
    ];

    const count = countAllMovements(transactions);

    // Both BTC (with price) and ETH (without price) should be counted
    expect(count).toBe(2);
  });

  it('should handle transactions with no movements', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [],
          outflows: [],
        },
        fees: {},
      },
    ];

    const count = countAllMovements(transactions);

    expect(count).toBe(0);
  });
});

describe('countMovementsWithoutPrices', () => {
  it('should count only non-fiat movements without prices', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('1'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                source: 'coingecko',
                fetchedAt: new Date(),
              },
            },
          ],
          outflows: [{ asset: 'ETH', amount: parseDecimal('10') }],
        },
        fees: {},
      },
    ];

    const count = countMovementsWithoutPrices(transactions);

    // Only ETH lacks a price (BTC has price)
    expect(count).toBe(1);
  });

  it('should exclude fiat currencies even without prices', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [{ asset: 'USD', amount: parseDecimal('1000') }],
          outflows: [
            { asset: 'BTC', amount: parseDecimal('0.5') },
            { asset: 'EUR', amount: parseDecimal('900') },
          ],
        },
        fees: {},
      },
    ];

    const count = countMovementsWithoutPrices(transactions);

    // Only BTC lacks price (USD and EUR are fiat, excluded)
    expect(count).toBe(1);
  });

  it('should return 0 when all movements have prices', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: parseDecimal('1'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                source: 'coingecko',
                fetchedAt: new Date(),
              },
            },
          ],
          outflows: [
            {
              asset: 'ETH',
              amount: parseDecimal('10'),
              priceAtTxTime: {
                price: { amount: parseDecimal('3000'), currency: Currency.create('USD') },
                source: 'coingecko',
                fetchedAt: new Date(),
              },
            },
          ],
        },
        fees: {},
      },
    ];

    const count = countMovementsWithoutPrices(transactions);

    expect(count).toBe(0);
  });

  it('should return 0 for empty transactions array', () => {
    const count = countMovementsWithoutPrices([]);

    expect(count).toBe(0);
  });

  it('should count across multiple transactions', () => {
    const transactions: UniversalTransaction[] = [
      {
        id: 1,
        datetime: '2024-01-15T12:00:00.000Z',
        timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-1',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [{ asset: 'BTC', amount: parseDecimal('1') }],
          outflows: [{ asset: 'USD', amount: parseDecimal('50000') }],
        },
        fees: {},
      },
      {
        id: 2,
        datetime: '2024-01-16T12:00:00.000Z',
        timestamp: Date.parse('2024-01-16T12:00:00.000Z'),
        source: 'test',
        status: 'success',
        externalId: 'test-2',
        operation: { category: 'trade', type: 'sell' },
        movements: {
          inflows: [{ asset: 'EUR', amount: parseDecimal('45000') }],
          outflows: [{ asset: 'ETH', amount: parseDecimal('10') }],
        },
        fees: {},
      },
    ];

    const count = countMovementsWithoutPrices(transactions);

    // BTC and ETH both lack prices (USD and EUR are fiat)
    expect(count).toBe(2);
  });
});

describe('movementNeedsPrice', () => {
  it('should return true for crypto movement without price', () => {
    const movement = { asset: 'BTC', amount: parseDecimal('1') };

    expect(movementNeedsPrice(movement)).toBe(true);
  });

  it('should return false for crypto movement with price', () => {
    const movement = {
      asset: 'BTC',
      amount: parseDecimal('1'),
      priceAtTxTime: {
        price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
        source: 'coingecko',
        fetchedAt: new Date(),
      },
    };

    expect(movementNeedsPrice(movement)).toBe(false);
  });

  it('should return false for fiat movement without price', () => {
    const movement = { asset: 'USD', amount: parseDecimal('1000') };

    // Fiat doesn't need prices
    expect(movementNeedsPrice(movement)).toBe(false);
  });

  it('should return false for fiat movement with price', () => {
    const movement = {
      asset: 'EUR',
      amount: parseDecimal('900'),
      priceAtTxTime: {
        price: { amount: parseDecimal('1.08'), currency: Currency.create('USD') },
        source: 'ecb',
        fetchedAt: new Date(),
      },
    };

    // Fiat doesn't need prices
    expect(movementNeedsPrice(movement)).toBe(false);
  });
});

describe('countTransactionMovementsNeedingPrices', () => {
  it('should count movements needing prices in a single transaction', () => {
    const tx: UniversalTransaction = {
      id: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [
          { asset: 'BTC', amount: parseDecimal('1') },
          {
            asset: 'ETH',
            amount: parseDecimal('10'),
            priceAtTxTime: {
              price: { amount: parseDecimal('3000'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
            },
          },
        ],
        outflows: [{ asset: 'USD', amount: parseDecimal('50000') }],
      },
      fees: {},
    };

    const count = countTransactionMovementsNeedingPrices(tx);

    // Only BTC lacks price (ETH has price, USD is fiat)
    expect(count).toBe(1);
  });

  it('should return 0 when all movements have prices or are fiat', () => {
    const tx: UniversalTransaction = {
      id: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
            },
          },
        ],
        outflows: [{ asset: 'USD', amount: parseDecimal('50000') }],
      },
      fees: {},
    };

    const count = countTransactionMovementsNeedingPrices(tx);

    expect(count).toBe(0);
  });

  it('should handle empty movements', () => {
    const tx: UniversalTransaction = {
      id: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: {},
    };

    const count = countTransactionMovementsNeedingPrices(tx);

    expect(count).toBe(0);
  });
});

describe('getNonFiatMovements', () => {
  it('should return only non-fiat movements', () => {
    const tx: UniversalTransaction = {
      id: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [
          { asset: 'BTC', amount: parseDecimal('1') },
          { asset: 'ETH', amount: parseDecimal('10') },
        ],
        outflows: [
          { asset: 'USD', amount: parseDecimal('50000') },
          { asset: 'EUR', amount: parseDecimal('45000') },
        ],
      },
      fees: {},
    };

    const movements = getNonFiatMovements(tx);

    expect(movements).toHaveLength(2);
    expect(movements[0]?.asset).toBe('BTC');
    expect(movements[1]?.asset).toBe('ETH');
  });

  it('should return empty array when only fiat movements exist', () => {
    const tx: UniversalTransaction = {
      id: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [{ asset: 'USD', amount: parseDecimal('1000') }],
        outflows: [{ asset: 'EUR', amount: parseDecimal('900') }],
      },
      fees: {},
    };

    const movements = getNonFiatMovements(tx);

    expect(movements).toHaveLength(0);
  });

  it('should include movements with and without prices', () => {
    const tx: UniversalTransaction = {
      id: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
            },
          },
        ],
        outflows: [{ asset: 'ETH', amount: parseDecimal('10') }],
      },
      fees: {},
    };

    const movements = getNonFiatMovements(tx);

    // Both BTC (with price) and ETH (without price) should be included
    expect(movements).toHaveLength(2);
  });

  it('should return empty array for transaction with no movements', () => {
    const tx: UniversalTransaction = {
      id: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: {},
    };

    const movements = getNonFiatMovements(tx);

    expect(movements).toHaveLength(0);
  });
});
