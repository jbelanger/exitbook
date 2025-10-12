import { describe, expect, it } from 'vitest';

import {
  BinanceErrorResponseSchema,
  BinanceExchangeInfoResponseSchema,
  BinanceExchangeInfoSymbolSchema,
  BinanceKlineSchema,
  BinanceKlinesResponseSchema,
} from '../schemas.js';

describe('BinanceKlineSchema', () => {
  it('validates valid kline data', () => {
    const validKline = [
      1704067200000, // Open time
      '43000.00', // Open
      '43100.00', // High
      '42900.00', // Low
      '43050.00', // Close
      '100.5', // Volume
      1704067259999, // Close time
      '4324500.00', // Quote asset volume
      500, // Number of trades
      '50.25', // Taker buy base asset volume
      '2162250.00', // Taker buy quote asset volume
      '0', // Unused
    ];

    const result = BinanceKlineSchema.safeParse(validKline);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toBe(1704067200000);
      expect(result.data[1]).toBe('43000.00');
      expect(result.data[4]).toBe('43050.00'); // Close price
    }
  });

  it('rejects kline with wrong number of elements', () => {
    const invalidKline = [
      1704067200000,
      '43000.00',
      '43100.00',
      // Missing elements
    ];

    const result = BinanceKlineSchema.safeParse(invalidKline);

    expect(result.success).toBe(false);
  });

  it('rejects kline with wrong types', () => {
    const invalidKline = [
      '1704067200000', // Should be number, not string
      '43000.00',
      '43100.00',
      '42900.00',
      '43050.00',
      '100.5',
      1704067259999,
      '4324500.00',
      500,
      '50.25',
      '2162250.00',
      '0',
    ];

    const result = BinanceKlineSchema.safeParse(invalidKline);

    expect(result.success).toBe(false);
  });

  it('accepts different numeric values for prices', () => {
    const validKline = [
      1704067200000,
      '0.00012345', // Very small price
      '0.00012400',
      '0.00012300',
      '0.00012350',
      '1000000.5',
      1704067259999,
      '123.456',
      1,
      '0.5',
      '61.728',
      '0',
    ];

    const result = BinanceKlineSchema.safeParse(validKline);

    expect(result.success).toBe(true);
  });
});

describe('BinanceKlinesResponseSchema', () => {
  it('validates array of klines', () => {
    const validResponse = [
      [
        1704067200000,
        '43000.00',
        '43100.00',
        '42900.00',
        '43050.00',
        '100.5',
        1704067259999,
        '4324500.00',
        500,
        '50.25',
        '2162250.00',
        '0',
      ],
      [
        1704067260000,
        '43050.00',
        '43150.00',
        '43000.00',
        '43100.00',
        '95.3',
        1704067319999,
        '4111000.00',
        480,
        '47.65',
        '2055500.00',
        '0',
      ],
    ];

    const result = BinanceKlinesResponseSchema.safeParse(validResponse);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('validates empty array', () => {
    const emptyResponse: unknown[] = [];

    const result = BinanceKlinesResponseSchema.safeParse(emptyResponse);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('rejects array with invalid kline', () => {
    const invalidResponse = [
      [
        1704067200000,
        '43000.00',
        '43100.00',
        '42900.00',
        '43050.00',
        '100.5',
        1704067259999,
        '4324500.00',
        500,
        '50.25',
        '2162250.00',
        '0',
      ],
      [
        '1704067260000', // Wrong type - should be number
        '43050.00',
        '43150.00',
        '43000.00',
        '43100.00',
        '95.3',
        1704067319999,
        '4111000.00',
        480,
        '47.65',
        '2055500.00',
        '0',
      ],
    ];

    const result = BinanceKlinesResponseSchema.safeParse(invalidResponse);

    expect(result.success).toBe(false);
  });

  it('rejects non-array input', () => {
    const invalidResponse = { data: 'not an array' };

    const result = BinanceKlinesResponseSchema.safeParse(invalidResponse);

    expect(result.success).toBe(false);
  });
});

describe('BinanceErrorResponseSchema', () => {
  it('validates valid error response', () => {
    const validError = {
      code: -1121,
      msg: 'Invalid symbol.',
    };

    const result = BinanceErrorResponseSchema.safeParse(validError);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe(-1121);
      expect(result.data.msg).toBe('Invalid symbol.');
    }
  });

  it('validates error with different codes', () => {
    const errors = [
      { code: -1003, msg: 'Too many requests.' },
      { code: -1013, msg: 'Invalid quantity.' },
      { code: -2011, msg: 'Unknown order sent.' },
    ];

    for (const error of errors) {
      const result = BinanceErrorResponseSchema.safeParse(error);
      expect(result.success).toBe(true);
    }
  });

  it('rejects error without code', () => {
    const invalidError = {
      msg: 'Invalid symbol.',
    };

    const result = BinanceErrorResponseSchema.safeParse(invalidError);

    expect(result.success).toBe(false);
  });

  it('rejects error without msg', () => {
    const invalidError = {
      code: -1121,
    };

    const result = BinanceErrorResponseSchema.safeParse(invalidError);

    expect(result.success).toBe(false);
  });

  it('rejects error with wrong types', () => {
    const invalidError = {
      code: '-1121', // Should be number
      msg: 'Invalid symbol.',
    };

    const result = BinanceErrorResponseSchema.safeParse(invalidError);

    expect(result.success).toBe(false);
  });
});

describe('BinanceExchangeInfoSymbolSchema', () => {
  it('validates valid symbol info', () => {
    const validSymbol = {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
    };

    const result = BinanceExchangeInfoSymbolSchema.safeParse(validSymbol);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('BTCUSDT');
      expect(result.data.baseAsset).toBe('BTC');
      expect(result.data.quoteAsset).toBe('USDT');
    }
  });

  it('validates symbol with different statuses', () => {
    const symbols = [
      {
        symbol: 'ETHUSDT',
        status: 'TRADING',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
      },
      {
        symbol: 'BNBBTC',
        status: 'BREAK',
        baseAsset: 'BNB',
        quoteAsset: 'BTC',
      },
      {
        symbol: 'ADABUSD',
        status: 'HALT',
        baseAsset: 'ADA',
        quoteAsset: 'BUSD',
      },
    ];

    for (const symbol of symbols) {
      const result = BinanceExchangeInfoSymbolSchema.safeParse(symbol);
      expect(result.success).toBe(true);
    }
  });

  it('rejects symbol missing required fields', () => {
    const invalidSymbol = {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      // Missing baseAsset and quoteAsset
    };

    const result = BinanceExchangeInfoSymbolSchema.safeParse(invalidSymbol);

    expect(result.success).toBe(false);
  });
});

describe('BinanceExchangeInfoResponseSchema', () => {
  it('validates valid exchange info response', () => {
    const validResponse = {
      symbols: [
        {
          symbol: 'BTCUSDT',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
        },
        {
          symbol: 'ETHUSDT',
          status: 'TRADING',
          baseAsset: 'ETH',
          quoteAsset: 'USDT',
        },
      ],
    };

    const result = BinanceExchangeInfoResponseSchema.safeParse(validResponse);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbols).toHaveLength(2);
    }
  });

  it('validates response with empty symbols array', () => {
    const validResponse = {
      symbols: [],
    };

    const result = BinanceExchangeInfoResponseSchema.safeParse(validResponse);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbols).toHaveLength(0);
    }
  });

  it('rejects response without symbols field', () => {
    const invalidResponse = {
      data: 'missing symbols field',
    };

    const result = BinanceExchangeInfoResponseSchema.safeParse(invalidResponse);

    expect(result.success).toBe(false);
  });

  it('rejects response with invalid symbol in array', () => {
    const invalidResponse = {
      symbols: [
        {
          symbol: 'BTCUSDT',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
        },
        {
          symbol: 'ETHUSDT',
          status: 'TRADING',
          // Missing baseAsset and quoteAsset
        },
      ],
    };

    const result = BinanceExchangeInfoResponseSchema.safeParse(invalidResponse);

    expect(result.success).toBe(false);
  });
});
