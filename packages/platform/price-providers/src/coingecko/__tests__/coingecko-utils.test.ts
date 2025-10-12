import { Currency } from '@exitbook/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildBatchSimplePriceParams,
  buildSymbolToCoinIdMap,
  canUseSimplePrice,
  formatCoinGeckoDate,
  transformHistoricalResponse,
  transformSimplePriceResponse,
} from '../coingecko-utils.ts';

describe('buildSymbolToCoinIdMap', () => {
  it('builds a map using uppercased symbols and respects first coin IDs', () => {
    const map = buildSymbolToCoinIdMap([
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
      { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
    ]);

    expect(map.get('BTC')).toBe('bitcoin');
    expect(map.get('ETH')).toBe('ethereum');
  });

  it('prefers shorter coin IDs when duplicate symbols are present', () => {
    const map = buildSymbolToCoinIdMap([
      { id: 'bitcoin-legacy', symbol: 'btc', name: 'Bitcoin Legacy' },
      { id: 'btc', symbol: 'btc', name: 'Wrapped BTC' },
    ]);

    expect(map.get('BTC')).toBe('btc');
  });
});

describe('formatCoinGeckoDate', () => {
  it('formats the date in DD-MM-YYYY using UTC components', () => {
    const date = new Date(Date.UTC(2023, 4, 7, 15, 30));

    expect(formatCoinGeckoDate(date)).toBe('07-05-2023');
  });
});

describe('transformHistoricalResponse', () => {
  it('maps the historical response into PriceData with normalized casing', () => {
    const response = {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      market_data: {
        current_price: {
          usd: 30123.45,
        },
      },
    };

    const timestamp = new Date('2024-01-01T14:30:00Z');
    const fetchedAt = new Date('2024-01-01T15:05:00Z');

    const result = transformHistoricalResponse(
      response,
      Currency.create('btc'),
      timestamp,
      Currency.create('USD'),
      fetchedAt
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-01T00:00:00Z'), // Rounded to day
        price: 30123.45,
        currency: Currency.create('USD'),
        source: 'coingecko',
        fetchedAt,
        granularity: 'day',
      });
    }
  });

  it('returns error when the desired currency is absent in the response', () => {
    const response = {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      market_data: {
        current_price: {
          eur: 28000,
        },
      },
    };

    const result = transformHistoricalResponse(
      response,
      Currency.create('btc'),
      new Date(),
      Currency.create('USD'),
      new Date()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for');
      expect(result.error.message).toContain('not found');
    }
  });

  it('returns error when price is zero (delisted or unavailable asset)', () => {
    const response = {
      id: 'delisted-coin',
      symbol: 'del',
      name: 'Delisted Coin',
      market_data: {
        current_price: {
          usd: 0,
        },
      },
    };

    const timestamp = new Date('2024-01-01T00:00:00Z');

    const result = transformHistoricalResponse(
      response,
      Currency.create('DEL'),
      timestamp,
      Currency.create('USD'),
      new Date()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for DEL');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });

  it('returns error when price is negative', () => {
    const response = {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      market_data: {
        current_price: {
          usd: -100,
        },
      },
    };

    const result = transformHistoricalResponse(
      response,
      Currency.create('BTC'),
      new Date(),
      Currency.create('USD'),
      new Date()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for BTC');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });
});

describe('transformSimplePriceResponse', () => {
  it('maps the simple price response into PriceData', () => {
    const response = {
      bitcoin: {
        usd: 30123.45,
      },
    };

    const timestamp = new Date('2024-01-01T00:00:00Z');
    const fetchedAt = new Date('2024-01-01T00:05:00Z');

    const result = transformSimplePriceResponse(
      response,
      'bitcoin',
      Currency.create('btc'),
      timestamp,
      Currency.create('USD'),
      fetchedAt
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        asset: Currency.create('BTC'),
        timestamp,
        price: 30123.45,
        currency: Currency.create('USD'),
        source: 'coingecko',
        fetchedAt,
        granularity: undefined,
      });
    }
  });

  it('returns error when the target coin ID is missing', () => {
    const result = transformSimplePriceResponse(
      {},
      'bitcoin',
      Currency.create('btc'),
      new Date(),
      Currency.create('USD'),
      new Date()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Coin ID bitcoin for asset BTC not found in response');
    }
  });

  it('returns error when the desired currency is missing for the coin', () => {
    const response = {
      bitcoin: {
        eur: 28000,
      },
    };

    const result = transformSimplePriceResponse(
      response,
      'bitcoin',
      Currency.create('btc'),
      new Date(),
      Currency.create('USD'),
      new Date()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for');
      expect(result.error.message).toContain('not found');
    }
  });

  it('returns error when price is zero (delisted or unavailable asset)', () => {
    const response = {
      'delisted-coin': {
        usd: 0,
      },
    };

    const result = transformSimplePriceResponse(
      response,
      'delisted-coin',
      Currency.create('DEL'),
      new Date(),
      Currency.create('USD'),
      new Date()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for DEL');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });

  it('returns error when price is negative', () => {
    const response = {
      bitcoin: {
        usd: -100,
      },
    };

    const result = transformSimplePriceResponse(
      response,
      'bitcoin',
      Currency.create('BTC'),
      new Date(),
      Currency.create('USD'),
      new Date()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for BTC');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });
});

describe('canUseSimplePrice', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when the timestamp is within 24 hours of now', () => {
    vi.useFakeTimers();
    const now = new Date('2024-02-01T00:00:00Z');
    vi.setSystemTime(now);

    const recentTimestamp = new Date(now.getTime() - 23 * 60 * 60 * 1000);

    expect(canUseSimplePrice(recentTimestamp)).toBe(true);
  });

  it('returns false when the timestamp is older than 24 hours', () => {
    vi.useFakeTimers();
    const now = new Date('2024-02-01T00:00:00Z');
    vi.setSystemTime(now);

    const oldTimestamp = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    expect(canUseSimplePrice(oldTimestamp)).toBe(false);
  });
});

describe('buildBatchSimplePriceParams', () => {
  it('constructs the expected query parameter object', () => {
    const params = buildBatchSimplePriceParams(['bitcoin', 'ethereum'], Currency.create('USD'));

    expect(params).toEqual({
      ids: 'bitcoin,ethereum',
      vs_currencies: 'usd',
    });
  });
});
