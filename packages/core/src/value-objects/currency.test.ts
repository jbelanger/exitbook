import { describe, expect, it } from 'vitest';

import { Currency } from './currency.ts';

describe('Currency', () => {
  describe('create', () => {
    it('should normalize currency codes to uppercase', () => {
      const currency = Currency.create('btc');
      expect(currency.toString()).toBe('BTC');
    });

    it('should trim whitespace', () => {
      const currency = Currency.create('  BTC  ');
      expect(currency.toString()).toBe('BTC');
    });

    it('should throw error for empty string', () => {
      expect(() => Currency.create('')).toThrow('Currency code cannot be empty');
    });

    it('should throw error for whitespace-only string', () => {
      expect(() => Currency.create('   ')).toThrow('Currency code cannot be empty');
    });
  });

  describe('isFiat', () => {
    it('should identify major fiat currencies', () => {
      const fiats = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
      for (const code of fiats) {
        const currency = Currency.create(code);
        expect(currency.isFiat()).toBe(true);
      }
    });

    it('should identify Asian fiat currencies', () => {
      const fiats = ['CNY', 'HKD', 'SGD', 'KRW', 'INR', 'THB', 'IDR', 'MYR', 'PHP'];
      for (const code of fiats) {
        const currency = Currency.create(code);
        expect(currency.isFiat()).toBe(true);
      }
    });

    it('should identify Middle Eastern fiat currencies', () => {
      const fiats = ['AED', 'SAR', 'QAR', 'KWD', 'ILS', 'TRY'];
      for (const code of fiats) {
        const currency = Currency.create(code);
        expect(currency.isFiat()).toBe(true);
      }
    });

    it('should identify Latin American fiat currencies', () => {
      const fiats = ['BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN'];
      for (const code of fiats) {
        const currency = Currency.create(code);
        expect(currency.isFiat()).toBe(true);
      }
    });

    it('should return false for cryptocurrencies', () => {
      const cryptos = ['BTC', 'ETH', 'XRP', 'LTC', 'DOGE', 'SOL', 'ADA'];
      for (const code of cryptos) {
        const currency = Currency.create(code);
        expect(currency.isFiat()).toBe(false);
      }
    });

    it('should be case insensitive', () => {
      expect(Currency.create('usd').isFiat()).toBe(true);
      expect(Currency.create('UsD').isFiat()).toBe(true);
      expect(Currency.create('USD').isFiat()).toBe(true);
    });
  });

  describe('isStablecoin', () => {
    it('should identify major USD-pegged stablecoins', () => {
      const stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'GUSD'];
      for (const code of stablecoins) {
        const currency = Currency.create(code);
        expect(currency.isStablecoin()).toBe(true);
      }
    });

    it('should identify newer USD-pegged stablecoins', () => {
      const stablecoins = ['FDUSD', 'PYUSD', 'USDE', 'USDS'];
      for (const code of stablecoins) {
        const currency = Currency.create(code);
        expect(currency.isStablecoin()).toBe(true);
      }
    });

    it('should identify historical stablecoins', () => {
      const stablecoins = ['UST', 'USTC'];
      for (const code of stablecoins) {
        const currency = Currency.create(code);
        expect(currency.isStablecoin()).toBe(true);
      }
    });

    it('should return false for fiat currencies', () => {
      const fiats = ['USD', 'EUR', 'GBP'];
      for (const code of fiats) {
        const currency = Currency.create(code);
        expect(currency.isStablecoin()).toBe(false);
      }
    });

    it('should return false for regular cryptocurrencies', () => {
      const cryptos = ['BTC', 'ETH', 'XRP'];
      for (const code of cryptos) {
        const currency = Currency.create(code);
        expect(currency.isStablecoin()).toBe(false);
      }
    });

    it('should be case insensitive', () => {
      expect(Currency.create('usdt').isStablecoin()).toBe(true);
      expect(Currency.create('UsDt').isStablecoin()).toBe(true);
      expect(Currency.create('USDT').isStablecoin()).toBe(true);
    });
  });

  describe('isFiatOrStablecoin', () => {
    it('should return true for fiat currencies', () => {
      expect(Currency.create('USD').isFiatOrStablecoin()).toBe(true);
      expect(Currency.create('EUR').isFiatOrStablecoin()).toBe(true);
    });

    it('should return true for stablecoins', () => {
      expect(Currency.create('USDT').isFiatOrStablecoin()).toBe(true);
      expect(Currency.create('USDC').isFiatOrStablecoin()).toBe(true);
    });

    it('should return false for regular cryptocurrencies', () => {
      expect(Currency.create('BTC').isFiatOrStablecoin()).toBe(false);
      expect(Currency.create('ETH').isFiatOrStablecoin()).toBe(false);
      expect(Currency.create('SOL').isFiatOrStablecoin()).toBe(false);
    });
  });

  describe('equals', () => {
    it('should return true for same currency codes', () => {
      const btc1 = Currency.create('BTC');
      const btc2 = Currency.create('BTC');
      expect(btc1.equals(btc2)).toBe(true);
    });

    it('should return false for different currency codes', () => {
      const btc = Currency.create('BTC');
      const eth = Currency.create('ETH');
      expect(btc.equals(eth)).toBe(false);
    });

    it('should be case insensitive', () => {
      const btc1 = Currency.create('btc');
      const btc2 = Currency.create('BTC');
      expect(btc1.equals(btc2)).toBe(true);
    });
  });

  describe('toLowerCase', () => {
    it('should return lowercase version', () => {
      const currency = Currency.create('BTC');
      expect(currency.toLowerCase()).toBe('btc');
    });
  });

  describe('toJSON', () => {
    it('should serialize to currency code string', () => {
      const currency = Currency.create('BTC');
      expect(currency.toJSON()).toBe('BTC');
      expect(JSON.stringify({ currency })).toBe('{"currency":"BTC"}');
    });
  });
});
