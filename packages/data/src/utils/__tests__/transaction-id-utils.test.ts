import type { TransactionDraft } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { deriveTransactionFingerprint } from '../transaction-id-utils.js';

const BTC = 'BTC' as Currency;
const USD = 'USD' as Currency;

type BlockchainFingerprintInput = TransactionDraft & {
  identityMaterial?: undefined;
  sourceType: 'blockchain';
};

type ExchangeFingerprintInput = TransactionDraft & {
  sourceType: 'exchange';
};

function makeBlockchainTransactionDraft(
  overrides: Partial<BlockchainFingerprintInput> = {}
): BlockchainFingerprintInput {
  return {
    platformKey: 'kraken',
    sourceType: 'blockchain',
    datetime: '2023-11-14T22:13:20.000Z',
    status: 'success',
    timestamp: 1_700_000_000_000,
    operation: { category: 'trade', type: 'buy' },
    movements: {
      inflows: [{ assetSymbol: BTC, assetId: 'exchange:kraken:btc', grossAmount: new Decimal('1.5') }],
      outflows: [{ assetSymbol: USD, assetId: 'fiat:usd', grossAmount: new Decimal('45000') }],
    },
    fees: [],
    ...overrides,
  };
}

function makeExchangeTransactionDraft(overrides: Partial<ExchangeFingerprintInput> = {}): ExchangeFingerprintInput {
  return {
    ...makeBlockchainTransactionDraft({
      platformKey: 'kraken',
      sourceType: 'blockchain',
      blockchain: undefined,
    }),
    platformKey: 'kraken',
    sourceType: 'exchange',
    identityMaterial: {
      componentEventIds: ['evt-a', 'evt-b'],
    },
    ...overrides,
  };
}

describe('deriveTransactionFingerprint', () => {
  it('derives a blockchain fingerprint from blockchain.transaction_hash', async () => {
    const txFingerprint = assertOk(
      deriveTransactionFingerprint(
        makeBlockchainTransactionDraft({
          platformKey: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: {
            name: 'bitcoin',
            transaction_hash: '0xabc123',
            is_confirmed: true,
          },
        }),
        'a'.repeat(64)
      )
    );

    expect(txFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives an order-independent exchange fingerprint from componentEventIds', async () => {
    const first = assertOk(
      deriveTransactionFingerprint(
        makeExchangeTransactionDraft({
          identityMaterial: { componentEventIds: ['evt-b', 'evt-a'] },
        }),
        'b'.repeat(64)
      )
    );

    const second = assertOk(
      deriveTransactionFingerprint(
        makeExchangeTransactionDraft({
          identityMaterial: { componentEventIds: ['evt-a', 'evt-b'] },
        }),
        'b'.repeat(64)
      )
    );

    expect(first).toBe(second);
  });

  it('does not deduplicate duplicate exchange event IDs', async () => {
    const withDuplicate = assertOk(
      deriveTransactionFingerprint(
        makeExchangeTransactionDraft({
          identityMaterial: { componentEventIds: ['evt-a', 'evt-b', 'evt-a'] },
        }),
        'c'.repeat(64)
      )
    );

    const withoutDuplicate = assertOk(
      deriveTransactionFingerprint(
        makeExchangeTransactionDraft({
          identityMaterial: { componentEventIds: ['evt-a', 'evt-b'] },
        }),
        'c'.repeat(64)
      )
    );

    expect(withDuplicate).not.toBe(withoutDuplicate);
  });

  it('rejects exchange transactions without componentEventIds', async () => {
    const e = assertErr(
      deriveTransactionFingerprint(
        makeExchangeTransactionDraft({
          identityMaterial: undefined,
        }),
        'd'.repeat(64)
      )
    );

    expect(e.message).toContain('componentEventIds');
  });

  it('rejects exchange transactions with blank componentEventIds', async () => {
    const e = assertErr(
      deriveTransactionFingerprint(
        makeExchangeTransactionDraft({
          identityMaterial: { componentEventIds: ['   '] },
        }),
        'd'.repeat(64)
      )
    );

    expect(e.message).toContain('componentEventIds');
  });

  it('rejects blockchain transactions without blockchain.transaction_hash', async () => {
    const e = assertErr(
      deriveTransactionFingerprint(
        {
          ...makeBlockchainTransactionDraft({
            platformKey: 'bitcoin',
            sourceType: 'blockchain',
          }),
          blockchain: {
            is_confirmed: true,
            name: 'bitcoin',
          },
        } as unknown as BlockchainFingerprintInput,
        'e'.repeat(64)
      )
    );

    expect(e.message).toContain('blockchainTransactionHash');
  });
});
