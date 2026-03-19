/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import {
  type Currency,
  type PriceAtTxTime,
  type Transaction,
  type TransactionDraft,
  parseDecimal,
} from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { materializeTestTransaction } from '../../../__tests__/test-utils.js';
import type { IPricingPersistence } from '../../../ports/pricing-persistence.js';
import type { IFxRateProvider } from '../../shared/types.js';
import { PriceNormalizationService } from '../price-normalization-service.js';

// ── Fixtures ──

let nextId = 1;

function makePrice(amount: string, currency: Currency): PriceAtTxTime {
  return {
    price: { amount: new Decimal(amount), currency },
    source: 'exchange-execution',
    fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
    granularity: 'exact' as const,
  };
}

function makeTx(
  overrides: Omit<Partial<Transaction>, 'fees' | 'movements'> & {
    fees?: TransactionDraft['fees'];
    movements: TransactionDraft['movements'];
  }
): Transaction {
  const id = nextId++;
  return materializeTestTransaction({
    id,
    accountId: 1,
    identityReference: `test-${id}`,
    datetime: '2023-01-15T10:00:00.000Z',
    timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
    source: 'test-exchange',
    sourceType: 'exchange',
    status: 'success',
    operation: { category: 'trade', type: 'buy' },
    fees: [],
    ...overrides,
  });
}

// ── Mock store ──

function createMockStore(transactions: Transaction[]): IPricingPersistence {
  const txMap = new Map(transactions.map((tx) => [tx.id, tx]));
  return {
    loadPricingContext: vi.fn().mockResolvedValue(ok({ transactions: [...txMap.values()], confirmedLinks: [] })),
    loadTransactionsNeedingPrices: vi.fn().mockResolvedValue(ok([])),
    saveTransactionPrices: vi.fn().mockImplementation((tx: Transaction) => {
      txMap.set(tx.id, tx);
      return ok(undefined);
    }),
  };
}

function createMockFxProvider(): IFxRateProvider {
  return { getRateToUSD: vi.fn() } as unknown as IFxRateProvider;
}

// ── Tests ──

describe('PriceNormalizationService', () => {
  let mockFxProvider: IFxRateProvider;

  beforeEach(() => {
    nextId = 1;
    mockFxProvider = createMockFxProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createService(transactions: Transaction[]): PriceNormalizationService {
    return new PriceNormalizationService(createMockStore(transactions), mockFxProvider);
  }

  describe('normalize()', () => {
    it('should normalize EUR prices to USD', async () => {
      const tx = makeTx({
        movements: {
          inflows: [
            {
              assetId: 'exchange:test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1.0'),
              priceAtTxTime: makePrice('40000', 'EUR' as Currency),
            },
          ],
          outflows: [{ assetId: 'fiat:eur', assetSymbol: 'EUR' as Currency, grossAmount: new Decimal('40000') }],
        },
      });

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1);
        expect(result.value.movementsSkipped).toBe(0);
        expect(result.value.failures).toBe(0);
        expect(result.value.errors).toHaveLength(0);
      }
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith('EUR' as Currency, new Date('2023-01-15T10:00:00Z'));
    });

    it('should skip USD prices (already normalized)', async () => {
      const tx = makeTx({
        movements: {
          inflows: [
            {
              assetId: 'exchange:test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1.0'),
              priceAtTxTime: makePrice('50000', 'USD' as Currency),
            },
          ],
        },
      });

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1);
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should skip crypto prices (BTC priced in ETH)', async () => {
      const tx = makeTx({
        movements: {
          inflows: [
            {
              assetId: 'exchange:test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1.0'),
              priceAtTxTime: makePrice('15', 'ETH' as Currency),
            },
          ],
        },
      });

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1);
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should handle FX rate fetch failures gracefully', async () => {
      const tx = makeTx({
        movements: {
          inflows: [
            {
              assetId: 'exchange:test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1.0'),
              priceAtTxTime: makePrice('40000', 'EUR' as Currency),
            },
          ],
        },
      });

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(err(new Error('Provider unavailable')));

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.failures).toBe(1);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]).toContain('Provider unavailable');
      }
    });

    it('should normalize multiple currencies in a single transaction', async () => {
      const tx = makeTx({
        movements: {
          inflows: [
            {
              assetId: 'exchange:test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1.0'),
              priceAtTxTime: makePrice('40000', 'EUR' as Currency),
            },
            {
              assetId: 'exchange:test:eth',
              assetSymbol: 'ETH' as Currency,
              grossAmount: new Decimal('10.0'),
              priceAtTxTime: makePrice('2500', 'CAD' as Currency),
            },
          ],
        },
      });

      vi.mocked(mockFxProvider.getRateToUSD)
        .mockResolvedValueOnce(
          ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
        )
        .mockResolvedValueOnce(
          ok({ rate: parseDecimal('0.74'), source: 'bank-of-canada', fetchedAt: new Date('2023-01-15T10:00:00Z') })
        );

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(2);
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledTimes(2);
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith('EUR' as Currency, new Date('2023-01-15T10:00:00Z'));
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith('CAD' as Currency, new Date('2023-01-15T10:00:00Z'));
    });

    it('should normalize platform fees with non-USD fiat prices', async () => {
      const tx = makeTx({
        movements: {
          inflows: [{ assetId: 'exchange:test:btc', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('1.0') }],
          outflows: [{ assetId: 'fiat:usd', assetSymbol: 'USD' as Currency, grossAmount: new Decimal('50000') }],
        },
        fees: [
          {
            assetId: 'fiat:eur',
            assetSymbol: 'EUR' as Currency,
            amount: new Decimal('100'),
            scope: 'platform',
            settlement: 'balance',
            priceAtTxTime: makePrice('100', 'EUR' as Currency),
          },
        ],
      });

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1);
        expect(result.value.failures).toBe(0);
      }
    });

    it('should normalize network fees with non-USD fiat prices', async () => {
      const tx = makeTx({
        movements: {
          inflows: [{ assetId: 'exchange:test:btc', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('1.0') }],
          outflows: [{ assetId: 'fiat:usd', assetSymbol: 'USD' as Currency, grossAmount: new Decimal('50000') }],
        },
        fees: [
          {
            assetId: 'fiat:gbp',
            assetSymbol: 'GBP' as Currency,
            amount: new Decimal('50'),
            scope: 'network',
            settlement: 'on-chain',
            priceAtTxTime: makePrice('50', 'GBP' as Currency),
          },
        ],
      });

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.27'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1);
        expect(result.value.failures).toBe(0);
      }
    });

    it('should skip movements without prices', async () => {
      const tx = makeTx({
        operation: { category: 'transfer', type: 'deposit' },
        movements: {
          inflows: [
            { assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('1.0') },
          ],
        },
      });

      const result = await createService([tx]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(0);
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should process multiple transactions correctly', async () => {
      // tx1: BTC with EUR price — needs normalization
      const tx1 = makeTx({
        movements: {
          inflows: [
            {
              assetId: 'exchange:test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1.0'),
              priceAtTxTime: makePrice('40000', 'EUR' as Currency),
            },
          ],
        },
      });

      // tx2: ETH with USD price — already normalized, skip
      const tx2 = makeTx({
        datetime: '2023-01-16T10:00:00.000Z',
        timestamp: new Date('2023-01-16T10:00:00.000Z').getTime(),
        movements: {
          inflows: [
            {
              assetId: 'exchange:test:eth',
              assetSymbol: 'ETH' as Currency,
              grossAmount: new Decimal('10.0'),
              priceAtTxTime: makePrice('50000', 'USD' as Currency),
            },
          ],
        },
      });

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService([tx1, tx2]).normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1);
        expect(result.value.movementsSkipped).toBe(1);
        expect(result.value.failures).toBe(0);
      }
    });
  });
});
