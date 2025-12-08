import type { UniversalTransactionData } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { generateDeterministicTransactionHash } from '../transaction-id-utils.js';

describe('generateDeterministicTransactionHash', () => {
  it('should generate same hash for identical transactions', () => {
    const transaction: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'kucoin',
      status: 'closed',
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') }],
        outflows: [{ asset: 'USDT', grossAmount: new Decimal('20000'), netAmount: new Decimal('20000') }],
      },
      fees: [{ asset: 'USDT', amount: new Decimal('10'), scope: 'platform', settlement: 'balance' }],
      operation: { category: 'trade', type: 'buy' },
    };

    const hash1 = generateDeterministicTransactionHash(transaction);
    const hash2 = generateDeterministicTransactionHash(transaction);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^gen-[a-f0-9]{64}$/);
  });

  it('should generate different hashes for different transactions', () => {
    const tx1: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'kucoin',
      status: 'closed',
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') }],
        outflows: [{ asset: 'USDT', grossAmount: new Decimal('20000'), netAmount: new Decimal('20000') }],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    };

    const tx2: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      ...tx1,
      timestamp: 1705318300000, // Different timestamp
    };

    const hash1 = generateDeterministicTransactionHash(tx1);
    const hash2 = generateDeterministicTransactionHash(tx2);

    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hashes for different amounts', () => {
    const tx1: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'kucoin',
      status: 'closed',
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') }],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const tx2: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      ...tx1,
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: new Decimal('0.6'), netAmount: new Decimal('0.6') }],
        outflows: [],
      },
    };

    const hash1 = generateDeterministicTransactionHash(tx1);
    const hash2 = generateDeterministicTransactionHash(tx2);

    expect(hash1).not.toBe(hash2);
  });

  it('should generate same hash regardless of movement order', () => {
    const tx1: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'kucoin',
      status: 'closed',
      movements: {
        inflows: [
          { asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') },
          { asset: 'ETH', grossAmount: new Decimal('2'), netAmount: new Decimal('2') },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const tx2: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      ...tx1,
      movements: {
        inflows: [
          { asset: 'ETH', grossAmount: new Decimal('2'), netAmount: new Decimal('2') },
          { asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') },
        ],
        outflows: [],
      },
    };

    const hash1 = generateDeterministicTransactionHash(tx1);
    const hash2 = generateDeterministicTransactionHash(tx2);

    expect(hash1).toBe(hash2);
  });

  it('should include fees in hash calculation', () => {
    const tx1: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'kucoin',
      status: 'closed',
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') }],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const tx2: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      ...tx1,
      fees: [{ asset: 'BTC', amount: new Decimal('0.001'), scope: 'network', settlement: 'balance' }],
    };

    const hash1 = generateDeterministicTransactionHash(tx1);
    const hash2 = generateDeterministicTransactionHash(tx2);

    expect(hash1).not.toBe(hash2);
  });

  it('should include from/to addresses in hash calculation', () => {
    const tx1: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'bitcoin',
      status: 'success',
      from: 'bc1qaddress1',
      to: 'bc1qaddress2',
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') }],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const tx2: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      ...tx1,
      from: 'bc1qaddress3', // Different from address
    };

    const hash1 = generateDeterministicTransactionHash(tx1);
    const hash2 = generateDeterministicTransactionHash(tx2);

    expect(hash1).not.toBe(hash2);
  });

  it('should handle transactions with no movements gracefully', () => {
    const transaction: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'kucoin',
      status: 'closed',
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: [],
      operation: { category: 'fee', type: 'fee' },
    };

    const hash = generateDeterministicTransactionHash(transaction);

    expect(hash).toMatch(/^gen-[a-f0-9]{64}$/);
  });

  it('should include operation type in hash calculation', () => {
    const tx1: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'kucoin',
      status: 'closed',
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: new Decimal('0.5'), netAmount: new Decimal('0.5') }],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'deposit' },
    };

    const tx2: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      ...tx1,
      operation: { category: 'transfer', type: 'withdrawal' }, // Different operation type
    };

    const hash1 = generateDeterministicTransactionHash(tx1);
    const hash2 = generateDeterministicTransactionHash(tx2);

    expect(hash1).not.toBe(hash2);
  });

  it('should use netAmount when available, fallback to grossAmount', () => {
    const tx1: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      externalId: '',
      datetime: '2024-01-15T10:30:00Z',
      timestamp: 1705318200000,
      source: 'bitcoin',
      status: 'success',
      movements: {
        inflows: [],
        outflows: [{ asset: 'BTC', grossAmount: new Decimal('1.0'), netAmount: new Decimal('0.999') }],
      },
      fees: [],
      operation: { category: 'transfer', type: 'withdrawal' },
    };

    const tx2: Omit<UniversalTransactionData, 'id' | 'accountId'> = {
      ...tx1,
      movements: {
        inflows: [],
        outflows: [{ asset: 'BTC', grossAmount: new Decimal('1.0') }], // No netAmount
      },
    };

    const hash1 = generateDeterministicTransactionHash(tx1);
    const hash2 = generateDeterministicTransactionHash(tx2);

    // Should be different because netAmount differs
    expect(hash1).not.toBe(hash2);
  });
});
