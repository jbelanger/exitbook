/**
 * Tests for price provider error types
 */

import { describe, expect, it } from 'vitest';

import { CoinNotFoundError } from '../errors.js';

describe('CoinNotFoundError', () => {
  it('should create error with all properties', () => {
    const error = new CoinNotFoundError('Coin not found', 'BTC', 'coingecko', {
      suggestion: 'Try syncing coin list',
      timestamp: new Date('2024-01-01'),
      currency: 'USD',
    });

    expect(error.name).toBe('CoinNotFoundError');
    expect(error.message).toBe('Coin not found');
    expect(error.asset).toBe('BTC');
    expect(error.provider).toBe('coingecko');
    expect(error.details?.suggestion).toBe('Try syncing coin list');
    expect(error.details?.timestamp).toEqual(new Date('2024-01-01'));
    expect(error.details?.currency).toBe('USD');
  });

  it('should create error without details', () => {
    const error = new CoinNotFoundError('Coin not found', 'ETH', 'cryptocompare');

    expect(error.name).toBe('CoinNotFoundError');
    expect(error.message).toBe('Coin not found');
    expect(error.asset).toBe('ETH');
    expect(error.provider).toBe('cryptocompare');
    expect(error.details).toBeUndefined();
  });

  it('should identify CoinNotFoundError instances using instanceof', () => {
    const coinNotFoundError = new CoinNotFoundError('Not found', 'BTC', 'coingecko');
    const genericError = new Error('Generic error');

    expect(coinNotFoundError instanceof CoinNotFoundError).toBe(true);
    expect(genericError instanceof CoinNotFoundError).toBe(false);
  });

  it('should be instanceof Error', () => {
    const error = new CoinNotFoundError('Not found', 'BTC', 'coingecko');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof CoinNotFoundError).toBe(true);
  });
});
