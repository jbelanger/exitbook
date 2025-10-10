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

    const timestamp = new Date('2024-01-01T00:00:00Z');
    const fetchedAt = new Date('2024-01-01T00:05:00Z');

    const priceData = transformHistoricalResponse(response, 'btc', timestamp, 'USD', fetchedAt);

    expect(priceData).toEqual({
      asset: 'BTC',
      timestamp,
      price: 30123.45,
      currency: 'USD',
      source: 'coingecko',
      fetchedAt,
    });
  });

  it('throws when the desired currency is absent in the response', () => {
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

    expect(() => transformHistoricalResponse(response, 'btc', new Date(), 'USD', new Date())).toThrow(
      'Currency USD not found in response'
    );
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

    const priceData = transformSimplePriceResponse(response, 'bitcoin', 'btc', timestamp, 'USD', fetchedAt);

    expect(priceData).toEqual({
      asset: 'BTC',
      timestamp,
      price: 30123.45,
      currency: 'USD',
      source: 'coingecko',
      fetchedAt,
    });
  });

  it('throws when the target coin ID is missing', () => {
    expect(() => transformSimplePriceResponse({}, 'bitcoin', 'btc', new Date(), 'USD', new Date())).toThrow(
      'Coin ID bitcoin for asset btc not found in response'
    );
  });

  it('throws when the desired currency is missing for the coin', () => {
    const response = {
      bitcoin: {
        eur: 28000,
      },
    };

    expect(() => transformSimplePriceResponse(response, 'bitcoin', 'btc', new Date(), 'USD', new Date())).toThrow(
      'Currency USD not found for btc'
    );
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
    const params = buildBatchSimplePriceParams(['bitcoin', 'ethereum'], 'USD');

    expect(params).toEqual({
      ids: 'bitcoin,ethereum',
      vs_currencies: 'usd',
    });
  });
});
