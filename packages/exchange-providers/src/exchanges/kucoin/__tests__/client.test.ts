import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('ccxt', () => ({
  kucoin: vi.fn(),
}));

import * as ccxt from 'ccxt';

import { createKuCoinClient } from '../client.js';

const mockFetchBalance = vi.fn();
const mockKuCoinConstructor = vi.mocked(ccxt.kucoin);

describe('createKuCoinClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchBalance.mockReset();
    mockKuCoinConstructor.mockReset();
    mockKuCoinConstructor.mockImplementation(function MockKuCoin() {
      return { fetchBalance: mockFetchBalance } as never;
    } as never);
  });

  test('returns a validation error when required credentials are missing', () => {
    const result = createKuCoinClient({
      apiKey: '',
      apiSecret: 'test-secret',
      apiPassphrase: 'test-passphrase',
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('Invalid kucoin credentials');
  });

  test('yields an unsupported error for streaming imports', async () => {
    const result = createKuCoinClient({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      apiPassphrase: 'test-passphrase',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    const iterator = result.value.fetchTransactionDataStreaming?.();
    expect(iterator).toBeDefined();
    if (!iterator) {
      return;
    }

    const streamResults = [];
    for await (const streamResult of iterator) {
      streamResults.push(streamResult);
    }

    expect(streamResults).toHaveLength(1);
    expect(streamResults[0]?.isErr()).toBe(true);
    if (!streamResults[0]?.isErr()) {
      return;
    }

    expect(streamResults[0].error.message).toContain('KuCoin API import is not supported');
  });

  test('aggregates balances across account types and ignores unavailable account types', async () => {
    mockFetchBalance
      .mockResolvedValueOnce({
        BTC: { total: 1.25 },
        USDT: { total: 0.5 },
        info: { ignored: true },
      })
      .mockResolvedValueOnce({
        BTC: { total: 0.75 },
        ETH: { total: 2 },
        timestamp: Date.now(),
      })
      .mockRejectedValueOnce(new Error('margin account disabled'))
      .mockResolvedValueOnce({
        ETH: { total: 0.00000001 },
        SHIB: { total: 0.00000001 },
      });

    const result = createKuCoinClient({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      apiPassphrase: 'test-passphrase',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    const balanceResult = await result.value.fetchBalance();

    expect(mockKuCoinConstructor).toHaveBeenCalledWith({
      apiKey: 'test-key',
      secret: 'test-secret',
      password: 'test-passphrase',
    });
    expect(mockFetchBalance).toHaveBeenNthCalledWith(1, { type: 'main' });
    expect(mockFetchBalance).toHaveBeenNthCalledWith(2, { type: 'trade' });
    expect(mockFetchBalance).toHaveBeenNthCalledWith(3, { type: 'margin' });
    expect(mockFetchBalance).toHaveBeenNthCalledWith(4, { type: 'isolated' });

    expect(balanceResult.isOk()).toBe(true);
    if (!balanceResult.isOk()) {
      return;
    }

    expect(balanceResult.value.balances).toEqual({
      BTC: '2',
      ETH: '2.00000001',
      SHIB: '0.00000001',
      USDT: '0.5',
    });
    expect(balanceResult.value.timestamp).toEqual(expect.any(Number));
  });
});
