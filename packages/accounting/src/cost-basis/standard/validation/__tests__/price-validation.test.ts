import type { Currency, Transaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildTransaction } from '../../../../__tests__/test-utils.js';
import type { AccountingScopedBuildResult } from '../../matching/scoped-transaction-types.js';
import { assertScopedPriceDataQuality } from '../price-validation.js';

/**
 * Wrap transactions into a minimal AccountingScopedBuildResult so we can
 * exercise assertScopedPriceDataQuality (the only public API).
 */
function wrapAsScopedBuildResult(transactions: Transaction[]): AccountingScopedBuildResult {
  return {
    inputTransactions: transactions,
    transactions: transactions.map((tx) => ({
      tx,
      rebuildDependencyTransactionIds: [],
      movements: {
        inflows: tx.movements?.inflows ?? [],
        outflows: tx.movements?.outflows ?? [],
      },
      fees: (tx.fees ?? []).map((fee) => ({
        ...fee,
        originalTransactionId: tx.id,
        movementFingerprint: `fee-${tx.id}-${fee.assetSymbol}`,
      })),
    })),
    feeOnlyInternalCarryovers: [],
  };
}

describe('price-validation', () => {
  describe('assertScopedPriceDataQuality', () => {
    it('should return ok for valid transactions with USD prices', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          sourceType: 'blockchain',
          inflows: [{ assetSymbol: 'BTC', amount: '1.0', price: '50000', priceSource: 'test-provider' }],
          outflows: [{ assetSymbol: 'USD', amount: '50000', price: '1', priceSource: 'test-provider' }],
        }),
      ];

      const result = assertScopedPriceDataQuality(wrapAsScopedBuildResult(transactions));

      assertOk(result);
    });

    it('should return error for missing prices', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          sourceType: 'blockchain',
          inflows: [{ assetSymbol: 'BTC', amount: '1.0' }],
        }),
      ];

      const result = assertScopedPriceDataQuality(wrapAsScopedBuildResult(transactions));

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Price preflight validation failed');
      expect(resultError.message).toContain('1 price(s) missing');
    });

    it('should return error for non-USD prices', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          sourceType: 'blockchain',
          inflows: [
            {
              assetSymbol: 'BTC',
              amount: '1.0',
              price: '45000',
              priceCurrency: 'EUR',
              priceSource: 'test-provider',
            },
          ],
        }),
      ];

      const result = assertScopedPriceDataQuality(wrapAsScopedBuildResult(transactions));

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Price preflight validation failed');
      expect(resultError.message).toContain('1 price(s) not in USD');
    });

    it('should return error for incomplete FX metadata', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          sourceType: 'blockchain',
          inflows: [
            {
              assetSymbol: 'BTC',
              amount: '1.0',
              price: '50000',
              priceSource: 'test-provider',
              fxRateToUSD: '1.35',
              fxSource: 'ECB',
              // Missing fxTimestamp
            },
          ],
        }),
      ];

      const result = assertScopedPriceDataQuality(wrapAsScopedBuildResult(transactions));

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Price preflight validation failed');
      expect(resultError.message).toContain('missing complete FX audit trail');
    });

    it('should aggregate multiple issues', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          sourceType: 'blockchain',
          inflows: [{ assetSymbol: 'BTC', amount: '1.0' }],
          outflows: [
            {
              assetSymbol: 'ETH',
              amount: '10.0',
              price: '3000',
              priceCurrency: 'EUR',
              priceSource: 'test-provider',
            },
          ],
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('10'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: {
                price: { amount: parseDecimal('1'), currency: 'USD' as Currency },
                source: 'test-provider',
                fetchedAt: new Date('2024-01-15T10:00:00Z'),
                fxRateToUSD: parseDecimal('1.35'),
                fxSource: 'ECB',
                // Incomplete FX metadata
              },
            },
          ],
        }),
      ];

      const result = assertScopedPriceDataQuality(wrapAsScopedBuildResult(transactions));

      const resultError = assertErr(result);
      expect(resultError.message).toContain('1 price(s) missing');
      expect(resultError.message).toContain('1 price(s) not in USD');
      expect(resultError.message).toContain('missing complete FX audit trail');
    });

    it('should accept complete FX metadata', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          sourceType: 'blockchain',
          inflows: [
            {
              assetSymbol: 'BTC',
              amount: '1.0',
              price: '50000',
              priceSource: 'test-provider',
              fxRateToUSD: '1.35',
              fxSource: 'ECB',
              fxTimestamp: new Date('2024-01-15T10:00:00Z'),
            },
          ],
        }),
      ];

      const result = assertScopedPriceDataQuality(wrapAsScopedBuildResult(transactions));

      assertOk(result);
    });
  });
});
