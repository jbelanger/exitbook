import type { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { generateDeterministicTransactionHash } from '../transaction-id-utils.js';

const BTC = 'BTC' as Currency;
const ETH = 'ETH' as Currency;
const USD = 'USD' as Currency;

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    source: 'kraken',
    sourceType: 'exchange' as const,
    externalId: 'test-external-id',
    datetime: '2023-11-14T22:13:20.000Z',
    status: 'success' as const,
    timestamp: 1_700_000_000_000,
    operation: { category: 'trade' as const, type: 'buy' as const },
    movements: {
      inflows: [{ assetSymbol: BTC, assetId: 'exchange:kraken:btc', grossAmount: new Decimal('1.5') }],
      outflows: [{ assetSymbol: USD, assetId: 'fiat:usd', grossAmount: new Decimal('45000') }],
    },
    fees: [],
    ...overrides,
  };
}

describe('generateDeterministicTransactionHash', () => {
  it('returns a gen- prefixed SHA-256 hash', () => {
    const hash = generateDeterministicTransactionHash(makeTransaction());
    expect(hash).toMatch(/^gen-[a-f0-9]{64}$/);
  });

  it('produces identical hash for identical input', () => {
    const tx = makeTransaction();
    const hash1 = generateDeterministicTransactionHash(tx);
    const hash2 = generateDeterministicTransactionHash(tx);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different source', () => {
    const hash1 = generateDeterministicTransactionHash(makeTransaction({ source: 'kraken' }));
    const hash2 = generateDeterministicTransactionHash(makeTransaction({ source: 'coinbase' }));
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hash for different timestamp', () => {
    const hash1 = generateDeterministicTransactionHash(makeTransaction({ timestamp: 1_700_000_000_000 }));
    const hash2 = generateDeterministicTransactionHash(makeTransaction({ timestamp: 1_700_000_001_000 }));
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hash for different operation type', () => {
    const hash1 = generateDeterministicTransactionHash(
      makeTransaction({ operation: { category: 'trade', type: 'buy' } })
    );
    const hash2 = generateDeterministicTransactionHash(
      makeTransaction({ operation: { category: 'trade', type: 'sell' } })
    );
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hash for different amounts', () => {
    const tx1 = makeTransaction({
      movements: {
        inflows: [{ assetSymbol: BTC, assetId: 'exchange:kraken:btc', grossAmount: new Decimal('1.5') }],
      },
    });
    const tx2 = makeTransaction({
      movements: {
        inflows: [{ assetSymbol: BTC, assetId: 'exchange:kraken:btc', grossAmount: new Decimal('2.0') }],
      },
    });
    expect(generateDeterministicTransactionHash(tx1)).not.toBe(generateDeterministicTransactionHash(tx2));
  });

  it('is order-independent for movements (sorted for determinism)', () => {
    const tx1 = makeTransaction({
      movements: {
        inflows: [
          { assetSymbol: BTC, assetId: 'exchange:kraken:btc', grossAmount: new Decimal('1') },
          { assetSymbol: ETH, assetId: 'exchange:kraken:eth', grossAmount: new Decimal('10') },
        ],
      },
    });
    const tx2 = makeTransaction({
      movements: {
        inflows: [
          { assetSymbol: ETH, assetId: 'exchange:kraken:eth', grossAmount: new Decimal('10') },
          { assetSymbol: BTC, assetId: 'exchange:kraken:btc', grossAmount: new Decimal('1') },
        ],
      },
    });
    expect(generateDeterministicTransactionHash(tx1)).toBe(generateDeterministicTransactionHash(tx2));
  });

  it('includes from/to addresses when present', () => {
    const withAddr = makeTransaction({ from: 'addr1', to: 'addr2' });
    const withoutAddr = makeTransaction();
    expect(generateDeterministicTransactionHash(withAddr)).not.toBe(generateDeterministicTransactionHash(withoutAddr));
  });

  it('includes fees in the hash', () => {
    const noFees = makeTransaction({ fees: [] });
    const withFees = makeTransaction({
      fees: [{ assetSymbol: BTC, amount: new Decimal('0.0001'), scope: 'transaction', settlement: 'deducted' }],
    });
    expect(generateDeterministicTransactionHash(noFees)).not.toBe(generateDeterministicTransactionHash(withFees));
  });

  it('handles netAmount in movements', () => {
    const withNet = makeTransaction({
      movements: {
        inflows: [
          {
            assetSymbol: BTC,
            assetId: 'exchange:kraken:btc',
            grossAmount: new Decimal('1.5'),
            netAmount: new Decimal('1.4999'),
          },
        ],
      },
    });
    const withoutNet = makeTransaction({
      movements: {
        inflows: [{ assetSymbol: BTC, assetId: 'exchange:kraken:btc', grossAmount: new Decimal('1.5') }],
      },
    });
    expect(generateDeterministicTransactionHash(withNet)).not.toBe(generateDeterministicTransactionHash(withoutNet));
  });

  it('handles empty movements', () => {
    const tx = makeTransaction({ movements: {} });
    const hash = generateDeterministicTransactionHash(tx);
    expect(hash).toMatch(/^gen-[a-f0-9]{64}$/);
  });
});
