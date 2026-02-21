import { describe, expect, it } from 'vitest';

import type { Currency } from './currency.js';
import { isFiat, isFiatOrStablecoin, isStablecoin, parseCurrency } from './currency.js';

describe('parseCurrency', () => {
  it('should normalize currency codes to uppercase', () => {
    const result = parseCurrency('btc');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('BTC');
  });

  it('should trim whitespace', () => {
    const result = parseCurrency('  BTC  ');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('BTC');
  });

  it('should return Err for empty string', () => {
    expect(parseCurrency('').isErr()).toBe(true);
  });

  it('should return Err for whitespace-only string', () => {
    expect(parseCurrency('   ').isErr()).toBe(true);
  });
});

describe('isFiat', () => {
  it('should identify major fiat currencies', () => {
    const fiats = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
    for (const code of fiats) {
      expect(isFiat(code as Currency)).toBe(true);
    }
  });

  it('should identify Asian fiat currencies', () => {
    const fiats = ['CNY', 'HKD', 'SGD', 'KRW', 'INR', 'THB', 'IDR', 'MYR', 'PHP'];
    for (const code of fiats) {
      expect(isFiat(code as Currency)).toBe(true);
    }
  });

  it('should identify Middle Eastern fiat currencies', () => {
    const fiats = ['AED', 'SAR', 'QAR', 'KWD', 'ILS', 'TRY'];
    for (const code of fiats) {
      expect(isFiat(code as Currency)).toBe(true);
    }
  });

  it('should identify Latin American fiat currencies', () => {
    const fiats = ['BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN'];
    for (const code of fiats) {
      expect(isFiat(code as Currency)).toBe(true);
    }
  });

  it('should return false for cryptocurrencies', () => {
    const cryptos = ['BTC', 'ETH', 'XRP', 'LTC', 'DOGE', 'SOL', 'ADA'];
    for (const code of cryptos) {
      expect(isFiat(code as Currency)).toBe(false);
    }
  });

  it('should be case insensitive via parseCurrency', () => {
    expect(isFiat(parseCurrency('usd')._unsafeUnwrap())).toBe(true);
    expect(isFiat(parseCurrency('UsD')._unsafeUnwrap())).toBe(true);
    expect(isFiat(parseCurrency('USD')._unsafeUnwrap())).toBe(true);
  });
});

describe('isStablecoin', () => {
  it('should identify major USD-pegged stablecoins', () => {
    const stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'GUSD'];
    for (const code of stablecoins) {
      expect(isStablecoin(code as Currency)).toBe(true);
    }
  });

  it('should identify newer USD-pegged stablecoins', () => {
    const stablecoins = ['FDUSD', 'PYUSD', 'USDE', 'USDS'];
    for (const code of stablecoins) {
      expect(isStablecoin(code as Currency)).toBe(true);
    }
  });

  it('should identify historical stablecoins', () => {
    const stablecoins = ['UST', 'USTC'];
    for (const code of stablecoins) {
      expect(isStablecoin(code as Currency)).toBe(true);
    }
  });

  it('should return false for fiat currencies', () => {
    const fiats = ['USD', 'EUR', 'GBP'];
    for (const code of fiats) {
      expect(isStablecoin(code as Currency)).toBe(false);
    }
  });

  it('should return false for regular cryptocurrencies', () => {
    const cryptos = ['BTC', 'ETH', 'XRP'];
    for (const code of cryptos) {
      expect(isStablecoin(code as Currency)).toBe(false);
    }
  });

  it('should be case insensitive via parseCurrency', () => {
    expect(isStablecoin(parseCurrency('usdt')._unsafeUnwrap())).toBe(true);
    expect(isStablecoin(parseCurrency('UsDt')._unsafeUnwrap())).toBe(true);
    expect(isStablecoin(parseCurrency('USDT')._unsafeUnwrap())).toBe(true);
  });
});

describe('isFiatOrStablecoin', () => {
  it('should return true for fiat currencies', () => {
    expect(isFiatOrStablecoin('USD' as Currency)).toBe(true);
    expect(isFiatOrStablecoin('EUR' as Currency)).toBe(true);
  });

  it('should return true for stablecoins', () => {
    expect(isFiatOrStablecoin('USDT' as Currency)).toBe(true);
    expect(isFiatOrStablecoin('USDC' as Currency)).toBe(true);
  });

  it('should return false for regular cryptocurrencies', () => {
    expect(isFiatOrStablecoin('BTC' as Currency)).toBe(false);
    expect(isFiatOrStablecoin('ETH' as Currency)).toBe(false);
    expect(isFiatOrStablecoin('SOL' as Currency)).toBe(false);
  });
});

describe('Currency equality', () => {
  it('same codes are equal via ===', () => {
    const btc1 = parseCurrency('BTC')._unsafeUnwrap();
    const btc2 = parseCurrency('BTC')._unsafeUnwrap();
    expect(btc1 === btc2).toBe(true);
  });

  it('different codes are not equal', () => {
    const btc = parseCurrency('BTC')._unsafeUnwrap();
    const eth = parseCurrency('ETH')._unsafeUnwrap();
    expect(btc === eth).toBe(false);
  });

  it('case-normalized codes are equal', () => {
    const lower = parseCurrency('btc')._unsafeUnwrap();
    const upper = parseCurrency('BTC')._unsafeUnwrap();
    expect(lower === upper).toBe(true);
  });
});

describe('Currency as string', () => {
  it('toLowerCase works as native string method', () => {
    const currency = parseCurrency('BTC')._unsafeUnwrap();
    expect(currency.toLowerCase()).toBe('btc');
  });

  it('serializes as plain string in JSON', () => {
    const currency = parseCurrency('BTC')._unsafeUnwrap();
    expect(JSON.stringify({ currency })).toBe('{"currency":"BTC"}');
  });
});
