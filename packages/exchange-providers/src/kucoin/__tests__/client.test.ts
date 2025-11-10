import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IExchangeClient } from '../../core/types.js';
import { createKuCoinClient } from '../client.js';

vi.mock('ccxt', () => {
  const mockKuCoin = vi.fn();
  return {
    kucoin: mockKuCoin,
  };
});

describe('createKuCoinClient - fetchBalance', () => {
  let client: IExchangeClient;
  let mockFetchBalance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchBalance = vi.fn();

    (ccxt.kucoin as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchBalance: mockFetchBalance,
    }));

    const result = createKuCoinClient({
      apiKey: 'test-api-key',
      secret: 'test-secret',
      passphrase: 'test-passphrase',
    });

    if (result.isErr()) {
      throw new Error('Failed to create client in test setup');
    }

    client = result.value;
  });

  test('fetches and returns balances', async () => {
    const mockBalance = {
      BTC: { free: 1.5, used: 0.1, total: 1.6 },
      USDT: { free: 1000, used: 0, total: 1000 },
      ETH: { free: 10, used: 2, total: 12 },
      info: { someMetadata: 'value' },
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances, timestamp } = result.value;
    expect(balances.BTC).toBe('1.6');
    expect(balances.USDT).toBe('1000');
    expect(balances.ETH).toBe('12');
    expect(balances.info).toBeUndefined();
    expect(timestamp).toBeGreaterThan(0);
  });

  test('skips zero balances', async () => {
    const mockBalance = {
      BTC: { free: 1.5, used: 0, total: 1.5 },
      USDT: { free: 0, used: 0, total: 0 },
      ETH: { free: 0, used: 0, total: 0 },
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(balances.BTC).toBe('1.5');
    expect(balances.USDT).toBeUndefined();
    expect(balances.ETH).toBeUndefined();
  });

  test('handles empty balance response', async () => {
    const mockBalance = {
      info: {},
      timestamp: 1704067200000,
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(Object.keys(balances)).toHaveLength(0);
  });

  test('handles API errors gracefully', async () => {
    mockFetchBalance.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const result = await client.fetchBalance();

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toBeTruthy();
  });
});
