/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
/**
 * Tests for StandardFxRateProvider
 *
 * Verifies that the provider correctly delegates to PriceProviderManager
 * and handles rate inversion for getRateFromUSD
 */

import { type Currency, parseDecimal } from '@exitbook/core';
import type { PriceProviderManager } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandardFxRateProvider } from '../standard-fx-rate-provider.js';

describe('StandardFxRateProvider', () => {
  let mockPriceManager: PriceProviderManager;
  let provider: StandardFxRateProvider;

  beforeEach(() => {
    // Create mock PriceProviderManager
    mockPriceManager = {
      fetchPrice: vi.fn(),
    } as unknown as PriceProviderManager;

    provider = new StandardFxRateProvider(mockPriceManager);
  });

  describe('getRateToUSD', () => {
    it('fetches EUR → USD rate from price manager', async () => {
      const mockRate = parseDecimal('1.08');
      const mockFetchedAt = new Date('2023-01-15T10:00:00Z');
      const timestamp = new Date('2023-01-15T10:00:00Z');

      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(
        ok({
          data: {
            assetSymbol: 'EUR' as Currency,
            timestamp,
            currency: 'USD' as Currency,
            price: mockRate,
            source: 'ecb',
            fetchedAt: mockFetchedAt,
            granularity: 'day',
          },
          providerName: 'mock-provider',
        })
      );

      const result = await provider.getRateToUSD('EUR' as Currency, new Date('2023-01-15T10:00:00Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toFixed()).toBe('1.08');
        expect(result.value.source).toBe('ecb');
        expect(result.value.fetchedAt).toEqual(mockFetchedAt);
      }

      expect(mockPriceManager.fetchPrice).toHaveBeenCalledWith({
        assetSymbol: 'EUR' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2023-01-15T10:00:00Z'),
      });
    });

    it('fetches CAD → USD rate from price manager', async () => {
      const mockRate = parseDecimal('0.74');
      const mockFetchedAt = new Date('2023-06-20T00:00:00Z');
      const timestamp = new Date('2023-06-20T00:00:00Z');

      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(
        ok({
          data: {
            assetSymbol: 'CAD' as Currency,
            timestamp,
            currency: 'USD' as Currency,
            price: mockRate,
            source: 'bank-of-canada',
            fetchedAt: mockFetchedAt,
            granularity: 'day',
          },
          providerName: 'mock-provider',
        })
      );

      const result = await provider.getRateToUSD('CAD' as Currency, new Date('2023-06-20T00:00:00Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toFixed()).toBe('0.74');
        expect(result.value.source).toBe('bank-of-canada');
        expect(result.value.fetchedAt).toEqual(mockFetchedAt);
      }
    });

    it('returns error when price manager fails', async () => {
      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(err(new Error('Provider unavailable')));

      const result = await provider.getRateToUSD('EUR' as Currency, new Date('2023-01-15T10:00:00Z'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to fetch FX rate for EUR → USD');
        expect(result.error.message).toContain('Provider unavailable');
      }
    });
  });

  describe('getRateFromUSD', () => {
    it('inverts rate for USD → CAD conversion', async () => {
      // CAD → USD = 0.74, so USD → CAD should be 1/0.74 ≈ 1.3514
      const mockRate = parseDecimal('0.74');
      const mockFetchedAt = new Date('2023-06-20T00:00:00Z');
      const timestamp = new Date('2023-06-20T00:00:00Z');

      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(
        ok({
          data: {
            assetSymbol: 'CAD' as Currency,
            timestamp,
            currency: 'USD' as Currency,
            price: mockRate,
            source: 'bank-of-canada',
            fetchedAt: mockFetchedAt,
            granularity: 'day',
          },
          providerName: 'mock-provider',
        })
      );

      const result = await provider.getRateFromUSD('CAD' as Currency, new Date('2023-06-20T00:00:00Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 1 / 0.74 = 1.351351351...
        const expected = new Decimal(1).div(parseDecimal('0.74'));
        expect(result.value.rate.toFixed()).toBe(expected.toFixed());
        expect(result.value.source).toBe('bank-of-canada');
        expect(result.value.fetchedAt).toEqual(mockFetchedAt);
      }

      // Should fetch CAD → USD and then invert
      expect(mockPriceManager.fetchPrice).toHaveBeenCalledWith({
        assetSymbol: 'CAD' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2023-06-20T00:00:00Z'),
      });
    });

    it('inverts rate for USD → EUR conversion', async () => {
      // EUR → USD = 1.08, so USD → EUR should be 1/1.08 ≈ 0.9259
      const mockRate = parseDecimal('1.08');
      const mockFetchedAt = new Date('2023-01-15T10:00:00Z');
      const timestamp = new Date('2023-01-15T10:00:00Z');

      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(
        ok({
          data: {
            assetSymbol: 'EUR' as Currency,
            timestamp,
            currency: 'USD' as Currency,
            price: mockRate,
            source: 'ecb',
            fetchedAt: mockFetchedAt,
            granularity: 'day',
          },
          providerName: 'mock-provider',
        })
      );

      const result = await provider.getRateFromUSD('EUR' as Currency, new Date('2023-01-15T10:00:00Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 1 / 1.08 = 0.925925925...
        const expected = new Decimal(1).div(parseDecimal('1.08'));
        expect(result.value.rate.toFixed()).toBe(expected.toFixed());
        expect(result.value.source).toBe('ecb');
      }
    });

    it('returns error when price manager fails', async () => {
      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(err(new Error('No providers available')));

      const result = await provider.getRateFromUSD('CAD' as Currency, new Date('2023-06-20T00:00:00Z'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to fetch FX rate for USD → CAD');
        expect(result.error.message).toContain('No providers available');
      }
    });

    it('returns error when rate is zero (cannot invert)', async () => {
      const mockRate = parseDecimal('0');
      const mockFetchedAt = new Date('2023-06-20T00:00:00Z');
      const timestamp = new Date('2023-06-20T00:00:00Z');

      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(
        ok({
          data: {
            assetSymbol: 'CAD' as Currency,
            timestamp,
            currency: 'USD' as Currency,
            price: mockRate,
            source: 'test-provider',
            fetchedAt: mockFetchedAt,
            granularity: 'day',
          },
          providerName: 'mock-provider',
        })
      );

      const result = await provider.getRateFromUSD('CAD' as Currency, new Date('2023-06-20T00:00:00Z'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Cannot invert zero FX rate');
        expect(result.error.message).toContain('CAD → USD');
      }
    });

    it('handles high-precision decimal calculations correctly', async () => {
      // Test with a precise rate to ensure no rounding errors
      const mockRate = parseDecimal('0.7412345678901234');
      const mockFetchedAt = new Date('2023-06-20T00:00:00Z');
      const timestamp = new Date('2023-06-20T00:00:00Z');

      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(
        ok({
          data: {
            assetSymbol: 'CAD' as Currency,
            timestamp,
            currency: 'USD' as Currency,
            price: mockRate,
            source: 'bank-of-canada',
            fetchedAt: mockFetchedAt,
            granularity: 'day',
          },
          providerName: 'mock-provider',
        })
      );

      const result = await provider.getRateFromUSD('CAD' as Currency, new Date('2023-06-20T00:00:00Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const expected = new Decimal(1).div(mockRate);
        expect(result.value.rate.toFixed()).toBe(expected.toFixed());

        // Verify round-trip: rate * inverted ≈ 1
        const roundTrip = mockRate.mul(result.value.rate);
        expect(roundTrip.toDecimalPlaces(10).toFixed()).toBe('1');
      }
    });
  });

  describe('integration scenarios', () => {
    it('supports converting both to and from USD for the same currency', async () => {
      const cadToUsdRate = parseDecimal('0.74');
      const mockFetchedAt = new Date('2023-06-20T00:00:00Z');
      const timestamp = new Date('2023-06-20T00:00:00Z');
      const cad = 'CAD' as Currency;

      vi.spyOn(mockPriceManager, 'fetchPrice').mockResolvedValue(
        ok({
          data: {
            assetSymbol: cad,
            timestamp,
            currency: 'USD' as Currency,
            price: cadToUsdRate,
            source: 'bank-of-canada',
            fetchedAt: mockFetchedAt,
            granularity: 'day',
          },
          providerName: 'mock-provider',
        })
      );

      // Get CAD → USD
      const toUsdResult = await provider.getRateToUSD(cad, timestamp);
      expect(toUsdResult.isOk()).toBe(true);

      // Get USD → CAD
      const fromUsdResult = await provider.getRateFromUSD(cad, timestamp);
      expect(fromUsdResult.isOk()).toBe(true);

      // Verify they are inverses of each other
      if (toUsdResult.isOk() && fromUsdResult.isOk()) {
        const toUsd = toUsdResult.value.rate;
        const fromUsd = fromUsdResult.value.rate;

        // toUsd * fromUsd should equal 1
        const product = toUsd.mul(fromUsd);
        expect(product.toDecimalPlaces(10).toFixed()).toBe('1');
      }
    });
  });
});
