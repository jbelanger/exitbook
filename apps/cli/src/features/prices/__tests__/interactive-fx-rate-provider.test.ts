/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- acceptable for tests */
/**
 * Tests for InteractiveFxRateProvider
 *
 * Verifies that the provider correctly delegates to underlying provider
 * and falls back to interactive prompts when providers fail
 */

import type { FxRateData, IFxRateProvider } from '@exitbook/accounting';
import { Currency, parseDecimal } from '@exitbook/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InteractiveFxRateProvider } from '../interactive-fx-rate-provider.js';
import * as pricesPrompts from '../prices-prompts.js';

describe('InteractiveFxRateProvider', () => {
  let mockUnderlyingProvider: IFxRateProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest spy typing is complex
  let promptManualFxRateSpy: any;

  beforeEach(() => {
    // Create mock underlying provider
    mockUnderlyingProvider = {
      getRateToUSD: vi.fn(),
      getRateFromUSD: vi.fn(),
    };

    // Spy on prompt function
    promptManualFxRateSpy = vi.spyOn(pricesPrompts, 'promptManualFxRate');
  });

  describe('getRateToUSD', () => {
    describe('when underlying provider succeeds', () => {
      it('returns rate from underlying provider without prompting', async () => {
        const mockRate: FxRateData = {
          rate: parseDecimal('1.08'),
          source: 'ecb',
          fetchedAt: new Date('2023-01-15T10:00:00Z'),
        };

        vi.spyOn(mockUnderlyingProvider, 'getRateToUSD').mockResolvedValue(ok(mockRate));

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
        const result = await provider.getRateToUSD(Currency.create('EUR'), new Date('2023-01-15T10:00:00Z'));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.rate.toFixed()).toBe('1.08');
          expect(result.value.source).toBe('ecb');
        }

        // Should not prompt user
        expect(promptManualFxRateSpy).not.toHaveBeenCalled();
      });
    });

    describe('when underlying provider fails', () => {
      it('returns error immediately in non-interactive mode', async () => {
        const mockError = new Error('Provider unavailable');
        vi.spyOn(mockUnderlyingProvider, 'getRateToUSD').mockResolvedValue(err(mockError));

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, false);
        const result = await provider.getRateToUSD(Currency.create('EUR'), new Date('2023-01-15T10:00:00Z'));

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toBe('Provider unavailable');
        }

        // Should not prompt user in non-interactive mode
        expect(promptManualFxRateSpy).not.toHaveBeenCalled();
      });

      it('prompts for manual rate in interactive mode', async () => {
        const mockError = new Error('Provider unavailable');
        vi.spyOn(mockUnderlyingProvider, 'getRateToUSD').mockResolvedValue(err(mockError));

        const manualRate = {
          rate: parseDecimal('1.10'),
          source: 'user-provided',
        };
        promptManualFxRateSpy.mockResolvedValue(manualRate);

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
        const timestamp = new Date('2023-01-15T10:00:00Z');
        const result = await provider.getRateToUSD(Currency.create('EUR'), timestamp);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.rate.toFixed()).toBe('1.1');
          expect(result.value.source).toBe('user-provided');
        }

        // Should have prompted user
        expect(promptManualFxRateSpy).toHaveBeenCalledWith('EUR', 'USD', timestamp);
      });

      it('returns original error when user declines to provide manual rate', async () => {
        const mockError = new Error('Provider unavailable');
        vi.spyOn(mockUnderlyingProvider, 'getRateToUSD').mockResolvedValue(err(mockError));

        // User declines to provide manual rate
        promptManualFxRateSpy.mockResolvedValue(void 0);

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
        const result = await provider.getRateToUSD(Currency.create('EUR'), new Date('2023-01-15T10:00:00Z'));

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toBe('Provider unavailable');
        }

        expect(promptManualFxRateSpy).toHaveBeenCalled();
      });
    });
  });

  describe('getRateFromUSD', () => {
    describe('when underlying provider succeeds', () => {
      it('returns inverted rate from underlying provider without prompting', async () => {
        const mockRate: FxRateData = {
          rate: parseDecimal('1.35'), // USD → CAD
          source: 'bank-of-canada',
          fetchedAt: new Date('2023-06-20T00:00:00Z'),
        };

        vi.spyOn(mockUnderlyingProvider, 'getRateFromUSD').mockResolvedValue(ok(mockRate));

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
        const result = await provider.getRateFromUSD(Currency.create('CAD'), new Date('2023-06-20T00:00:00Z'));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.rate.toFixed()).toBe('1.35');
          expect(result.value.source).toBe('bank-of-canada');
        }

        // Should not prompt user
        expect(promptManualFxRateSpy).not.toHaveBeenCalled();
      });
    });

    describe('when underlying provider fails', () => {
      it('returns error immediately in non-interactive mode', async () => {
        const mockError = new Error('No providers available');
        vi.spyOn(mockUnderlyingProvider, 'getRateFromUSD').mockResolvedValue(err(mockError));

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, false);
        const result = await provider.getRateFromUSD(Currency.create('CAD'), new Date('2023-06-20T00:00:00Z'));

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toBe('No providers available');
        }

        // Should not prompt user in non-interactive mode
        expect(promptManualFxRateSpy).not.toHaveBeenCalled();
      });

      it('prompts for manual rate in interactive mode (USD → target)', async () => {
        const mockError = new Error('No providers available');
        vi.spyOn(mockUnderlyingProvider, 'getRateFromUSD').mockResolvedValue(err(mockError));

        const manualRate = {
          rate: parseDecimal('1.37'), // User-provided USD → CAD rate
          source: 'user-provided',
        };
        promptManualFxRateSpy.mockResolvedValue(manualRate);

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
        const timestamp = new Date('2023-06-20T00:00:00Z');
        const result = await provider.getRateFromUSD(Currency.create('CAD'), timestamp);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.rate.toFixed()).toBe('1.37');
          expect(result.value.source).toBe('user-provided');
        }

        // Should have prompted with USD as source
        expect(promptManualFxRateSpy).toHaveBeenCalledWith('USD', 'CAD', timestamp);
      });

      it('returns original error when user declines to provide manual rate', async () => {
        const mockError = new Error('No providers available');
        vi.spyOn(mockUnderlyingProvider, 'getRateFromUSD').mockResolvedValue(err(mockError));

        // User declines to provide manual rate
        promptManualFxRateSpy.mockResolvedValue(void 0);

        const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
        const result = await provider.getRateFromUSD(Currency.create('CAD'), new Date('2023-06-20T00:00:00Z'));

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toBe('No providers available');
        }

        expect(promptManualFxRateSpy).toHaveBeenCalled();
      });
    });
  });

  describe('integration scenarios', () => {
    it('uses same underlying provider for both directions', async () => {
      const toUsdRate: FxRateData = {
        rate: parseDecimal('0.74'),
        source: 'bank-of-canada',
        fetchedAt: new Date('2023-06-20T00:00:00Z'),
      };

      const fromUsdRate: FxRateData = {
        rate: parseDecimal('1.35'),
        source: 'bank-of-canada',
        fetchedAt: new Date('2023-06-20T00:00:00Z'),
      };

      vi.spyOn(mockUnderlyingProvider, 'getRateToUSD').mockResolvedValue(ok(toUsdRate));
      vi.spyOn(mockUnderlyingProvider, 'getRateFromUSD').mockResolvedValue(ok(fromUsdRate));

      const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
      const cad = Currency.create('CAD');
      const timestamp = new Date('2023-06-20T00:00:00Z');

      const toUsdResult = await provider.getRateToUSD(cad, timestamp);
      const fromUsdResult = await provider.getRateFromUSD(cad, timestamp);

      expect(toUsdResult.isOk()).toBe(true);
      expect(fromUsdResult.isOk()).toBe(true);

      // Verify underlying provider was called for both
      expect(mockUnderlyingProvider.getRateToUSD).toHaveBeenCalledWith(cad, timestamp);
      expect(mockUnderlyingProvider.getRateFromUSD).toHaveBeenCalledWith(cad, timestamp);
    });

    it('can mix provider success and manual entry in same session', async () => {
      const toUsdRate: FxRateData = {
        rate: parseDecimal('0.74'),
        source: 'bank-of-canada',
        fetchedAt: new Date('2023-06-20T00:00:00Z'),
      };

      // First call succeeds
      vi.spyOn(mockUnderlyingProvider, 'getRateToUSD').mockResolvedValue(ok(toUsdRate));

      // Second call fails, user provides manual rate
      vi.spyOn(mockUnderlyingProvider, 'getRateFromUSD').mockResolvedValue(err(new Error('Provider down')));
      promptManualFxRateSpy.mockResolvedValue({
        rate: parseDecimal('1.37'),
        source: 'user-provided',
      });

      const provider = new InteractiveFxRateProvider(mockUnderlyingProvider, true);
      const cad = Currency.create('CAD');
      const timestamp = new Date('2023-06-20T00:00:00Z');

      const toUsdResult = await provider.getRateToUSD(cad, timestamp);
      const fromUsdResult = await provider.getRateFromUSD(cad, timestamp);

      expect(toUsdResult.isOk()).toBe(true);
      if (toUsdResult.isOk()) {
        expect(toUsdResult.value.source).toBe('bank-of-canada');
      }

      expect(fromUsdResult.isOk()).toBe(true);
      if (fromUsdResult.isOk()) {
        expect(fromUsdResult.value.source).toBe('user-provided');
      }

      // User should only be prompted once (for fromUSD)
      expect(promptManualFxRateSpy).toHaveBeenCalledTimes(1);
    });
  });
});
