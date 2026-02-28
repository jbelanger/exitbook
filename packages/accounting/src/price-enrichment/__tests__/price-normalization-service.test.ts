/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
/**
 * Tests for PriceNormalizationService
 *
 * Integration tests using an in-memory database.
 * FX provider is mocked (it's a genuine external dependency).
 */

import { type Currency, parseDecimal } from '@exitbook/core';
import { createTestDataContext, DataContext } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PriceNormalizationService } from '../price-normalization-service.js';
import type { IFxRateProvider } from '../types.js';

function createMockFxProvider(): IFxRateProvider {
  return { getRateToUSD: vi.fn() } as unknown as IFxRateProvider;
}

async function setupPrerequisites(db: DataContext): Promise<{ accountId: number }> {
  const userResult = await db.users.create();
  if (userResult.isErr()) throw userResult.error;

  const accountResult = await db.accounts.findOrCreate({
    userId: userResult.value,
    accountType: 'exchange-api',
    sourceName: 'test-exchange',
    identifier: 'test-key',
  });
  if (accountResult.isErr()) throw accountResult.error;

  const sessionResult = await db.importSessions.create(accountResult.value.id);
  if (sessionResult.isErr()) throw sessionResult.error;

  return { accountId: accountResult.value.id };
}

describe('PriceNormalizationService', () => {
  let db: DataContext;
  let mockFxProvider: IFxRateProvider;
  let accountId: number;

  beforeEach(async () => {
    db = await createTestDataContext();
    ({ accountId } = await setupPrerequisites(db));
    mockFxProvider = createMockFxProvider();
  });

  afterEach(async () => {
    await db.close();
  });

  function createService(): PriceNormalizationService {
    return new PriceNormalizationService(db, mockFxProvider);
  }

  describe('normalize()', () => {
    it('should successfully normalize EUR prices to USD', async () => {
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('40000'), currency: 'EUR' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
            ],
            outflows: [
              {
                assetId: 'fiat:eur',
                assetSymbol: 'EUR' as Currency,
                grossAmount: new Decimal('40000'),
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService().normalize();

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
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('50000'), currency: 'USD' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      const result = await createService().normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1);
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should skip crypto prices (BTC priced in ETH)', async () => {
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('15'), currency: 'ETH' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      const result = await createService().normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1); // Crypto prices counted as skipped
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should handle FX rate fetch failures gracefully', async () => {
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('40000'), currency: 'EUR' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(err(new Error('Provider unavailable')));

      const result = await createService().normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.failures).toBe(1);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]).toContain('Provider unavailable');
      }
    });

    it('should normalize multiple currencies in a single transaction', async () => {
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('40000'), currency: 'EUR' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
              {
                assetId: 'exchange:test:eth',
                assetSymbol: 'ETH' as Currency,
                grossAmount: new Decimal('10.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('2500'), currency: 'CAD' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      vi.mocked(mockFxProvider.getRateToUSD)
        .mockResolvedValueOnce(
          ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
        )
        .mockResolvedValueOnce(
          ok({ rate: parseDecimal('0.74'), source: 'bank-of-canada', fetchedAt: new Date('2023-01-15T10:00:00Z') })
        );

      const result = await createService().normalize();

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
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
              },
            ],
            outflows: [
              {
                assetId: 'fiat:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: new Decimal('50000'),
              },
            ],
          },
          fees: [
            {
              assetId: 'fiat:eur',
              assetSymbol: 'EUR' as Currency,
              amount: new Decimal('100'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: {
                price: { amount: new Decimal('100'), currency: 'EUR' as Currency },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                granularity: 'exact',
              },
            },
          ],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService().normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Only the fee is normalized
        expect(result.value.failures).toBe(0);
      }
    });

    it('should normalize network fees with non-USD fiat prices', async () => {
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
              },
            ],
            outflows: [
              {
                assetId: 'fiat:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: new Decimal('50000'),
              },
            ],
          },
          fees: [
            {
              assetId: 'fiat:gbp',
              assetSymbol: 'GBP' as Currency,
              amount: new Decimal('50'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: {
                price: { amount: new Decimal('50'), currency: 'GBP' as Currency },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                granularity: 'exact',
              },
            },
          ],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.27'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService().normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Network fee normalized
        expect(result.value.failures).toBe(0);
      }
    });

    it('should skip movements without prices', async () => {
      const saveResult = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'transfer', type: 'deposit' },
          movements: {
            inflows: [
              {
                assetId: 'blockchain:bitcoin:native',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (saveResult.isErr()) throw saveResult.error;

      const result = await createService().normalize();

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
      const tx1Result = await db.transactions.save(
        {
          externalId: 'test-1',
          datetime: '2023-01-15T10:00:00.000Z',
          timestamp: new Date('2023-01-15T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('40000'), currency: 'EUR' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-15T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (tx1Result.isErr()) throw tx1Result.error;

      // tx2: ETH with USD price — already normalized, skip
      const tx2Result = await db.transactions.save(
        {
          externalId: 'test-2',
          datetime: '2023-01-16T10:00:00.000Z',
          timestamp: new Date('2023-01-16T10:00:00.000Z').getTime(),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetId: 'exchange:test:eth',
                assetSymbol: 'ETH' as Currency,
                grossAmount: new Decimal('10.0'),
                priceAtTxTime: {
                  price: { amount: new Decimal('50000'), currency: 'USD' as Currency },
                  source: 'exchange-execution',
                  fetchedAt: new Date('2023-01-16T10:00:00.000Z'),
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (tx2Result.isErr()) throw tx2Result.error;

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await createService().normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Only tx1 EUR normalized
        expect(result.value.movementsSkipped).toBe(1); // tx2 USD skipped
        expect(result.value.failures).toBe(0);
      }
    });
  });
});
