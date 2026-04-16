import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { buildTransaction } from '../../__tests__/test-utils.js';
import { buildAccountingModelFromTransactions } from '../build-accounting-model-from-transactions.js';
import { assertAccountingModelPriceDataQuality } from '../price-validation.js';

const noopLogger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
} as Logger;

function buildAccountingModel(transactions: Transaction[]) {
  return assertOk(buildAccountingModelFromTransactions(transactions, noopLogger));
}

describe('price-validation', () => {
  describe('assertAccountingModelPriceDataQuality', () => {
    it('should return ok for valid transactions with USD prices', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          platformKind: 'blockchain',
          inflows: [{ assetSymbol: 'BTC', amount: '1.0', price: '50000', priceSource: 'test-provider' }],
          outflows: [{ assetSymbol: 'USD', amount: '50000', price: '1', priceSource: 'test-provider' }],
        }),
      ];

      const result = assertAccountingModelPriceDataQuality(buildAccountingModel(transactions));

      assertOk(result);
    });

    it('should return error for missing prices', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          platformKind: 'blockchain',
          inflows: [{ assetSymbol: 'BTC', amount: '1.0' }],
        }),
      ];

      const result = assertAccountingModelPriceDataQuality(buildAccountingModel(transactions));

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Price preflight validation failed');
      expect(resultError.message).toContain('1 price(s) missing');
    });

    it('should return error for non-USD prices', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          platformKind: 'blockchain',
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

      const result = assertAccountingModelPriceDataQuality(buildAccountingModel(transactions));

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Price preflight validation failed');
      expect(resultError.message).toContain('1 price(s) not in USD');
    });

    it('should return error for incomplete FX metadata', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          platformKind: 'blockchain',
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

      const result = assertAccountingModelPriceDataQuality(buildAccountingModel(transactions));

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Price preflight validation failed');
      expect(resultError.message).toContain('missing complete FX audit trail');
    });

    it('should aggregate multiple issues', () => {
      const transactions = [
        buildTransaction({
          id: 1,
          datetime: '2024-01-15T10:00:00Z',
          platformKind: 'blockchain',
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

      const result = assertAccountingModelPriceDataQuality(buildAccountingModel(transactions));

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
          platformKind: 'blockchain',
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

      const result = assertAccountingModelPriceDataQuality(buildAccountingModel(transactions));

      assertOk(result);
    });
  });
});
