import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { FxRateProvider } from '../fx-rate-provider.js';

describe('FxRateProvider', () => {
  describe('getRateToUSD', () => {
    it('should return identity rate for USD', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.getRateToUSD('USD', datetime);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toString()).toBe('1');
        expect(result.value.source).toBe('identity');
        expect(result.value.timestamp).toEqual(datetime);
      }
    });

    it('should return manual rate when available', async () => {
      const manualRates = new Map([['EUR', parseDecimal('1.08')]]);
      const provider = new FxRateProvider(manualRates);
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.getRateToUSD('EUR', datetime);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toString()).toBe('1.08');
        expect(result.value.source).toBe('manual');
        expect(result.value.timestamp).toEqual(datetime);
      }
    });

    it('should normalize currency to uppercase', async () => {
      const manualRates = new Map([['EUR', parseDecimal('1.08')]]);
      const provider = new FxRateProvider(manualRates);
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.getRateToUSD('eur', datetime); // lowercase

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toString()).toBe('1.08');
      }
    });

    it('should handle lowercase keys in constructor map', async () => {
      const manualRates = new Map([['eur', parseDecimal('1.08')]]); // lowercase key in map
      const provider = new FxRateProvider(manualRates);
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.getRateToUSD('EUR', datetime); // uppercase lookup

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toString()).toBe('1.08');
      }
    });

    it('should return error for non-fiat currency', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.getRateToUSD('BTC', datetime);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('non-fiat currency');
      }
    });

    it('should return error for missing rate', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.getRateToUSD('EUR', datetime);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('FX rate unavailable');
      }
    });

    it('should handle common fiat currencies', async () => {
      const manualRates = new Map([
        ['EUR', parseDecimal('1.08')],
        ['GBP', parseDecimal('1.27')],
        ['CAD', parseDecimal('0.74')],
        ['JPY', parseDecimal('0.0067')],
      ]);
      const provider = new FxRateProvider(manualRates);
      const datetime = new Date('2024-01-01T12:00:00Z');

      const currencies = ['EUR', 'GBP', 'CAD', 'JPY'];
      const expectedRates = ['1.08', '1.27', '0.74', '0.0067'];

      for (let i = 0; i < currencies.length; i++) {
        const currency = currencies[i];
        const expectedRate = expectedRates[i];
        if (!currency || !expectedRate) continue;

        const result = await provider.getRateToUSD(currency, datetime);
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.rate.toString()).toBe(expectedRate);
        }
      }
    });
  });

  describe('convertToUSD', () => {
    it('should convert amount using FX rate', async () => {
      const manualRates = new Map([['EUR', parseDecimal('1.08')]]);
      const provider = new FxRateProvider(manualRates);
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.convertToUSD(parseDecimal('50000'), 'EUR', datetime);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.convertedAmount.toString()).toBe('54000'); // 50000 * 1.08
        expect(result.value.fxRate.toString()).toBe('1.08');
        expect(result.value.fxSource).toBe('manual');
      }
    });

    it('should handle USD without conversion', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.convertToUSD(parseDecimal('1000'), 'USD', datetime);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.convertedAmount.toString()).toBe('1000');
        expect(result.value.fxRate.toString()).toBe('1');
        expect(result.value.fxSource).toBe('identity');
      }
    });

    it('should return error when rate unavailable', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.convertToUSD(parseDecimal('1000'), 'EUR', datetime);

      expect(result.isErr()).toBe(true);
    });

    it('should preserve decimal precision', async () => {
      const manualRates = new Map([['EUR', parseDecimal('1.08543')]]);
      const provider = new FxRateProvider(manualRates);
      const datetime = new Date('2024-01-01T12:00:00Z');

      const result = await provider.convertToUSD(parseDecimal('1.5'), 'EUR', datetime);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.convertedAmount.toString()).toBe('1.628145'); // 1.5 * 1.08543
      }
    });
  });

  describe('addManualRate', () => {
    it('should add manual rate successfully', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      provider.addManualRate('EUR', parseDecimal('1.08'));

      const result = await provider.getRateToUSD('EUR', datetime);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toString()).toBe('1.08');
      }
    });

    it('should normalize currency code', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      provider.addManualRate('eur', parseDecimal('1.08')); // lowercase

      const result = await provider.getRateToUSD('EUR', datetime); // uppercase
      expect(result.isOk()).toBe(true);
    });

    it('should throw error for non-fiat currency', () => {
      const provider = new FxRateProvider();

      expect(() => {
        provider.addManualRate('BTC', parseDecimal('60000'));
      }).toThrow('non-fiat currency');
    });

    it('should overwrite existing manual rate', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      provider.addManualRate('EUR', parseDecimal('1.08'));
      provider.addManualRate('EUR', parseDecimal('1.10')); // overwrite

      const result = await provider.getRateToUSD('EUR', datetime);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rate.toString()).toBe('1.1'); // Decimal normalizes '1.10' to '1.1'
      }
    });
  });

  describe('hasRate', () => {
    it('should return true for USD', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const hasRate = await provider.hasRate('USD', datetime);

      expect(hasRate).toBe(true);
    });

    it('should return true for manual rate', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      provider.addManualRate('EUR', parseDecimal('1.08'));

      const hasRate = await provider.hasRate('EUR', datetime);

      expect(hasRate).toBe(true);
    });

    it('should return false for missing rate', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const hasRate = await provider.hasRate('EUR', datetime);

      expect(hasRate).toBe(false);
    });

    it('should return false for non-fiat currency', async () => {
      const provider = new FxRateProvider();
      const datetime = new Date('2024-01-01T12:00:00Z');

      const hasRate = await provider.hasRate('BTC', datetime);

      expect(hasRate).toBe(false);
    });
  });
});
