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

  test('returns a validation error when passphrase is missing', () => {
    const result = createKuCoinClient({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('Invalid kucoin credentials');
    expect(result.error.message).toContain('apiPassphrase');
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

  test('aggregates balances across liquid account types only', async () => {
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
    expect(mockFetchBalance).toHaveBeenCalledTimes(2);

    expect(balanceResult.isOk()).toBe(true);
    if (!balanceResult.isOk()) {
      return;
    }

    expect(balanceResult.value.balances).toEqual({
      BTC: '2',
      ETH: '2',
      USDT: '0.5',
    });
    expect(balanceResult.value.timestamp).toEqual(expect.any(Number));
  });

  test('fails when a required liquid account balance cannot be fetched', async () => {
    mockFetchBalance.mockResolvedValueOnce({ BTC: { total: 1.25 } }).mockRejectedValueOnce(new Error('trade down'));

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

    expect(mockFetchBalance).toHaveBeenNthCalledWith(1, { type: 'main' });
    expect(mockFetchBalance).toHaveBeenNthCalledWith(2, { type: 'trade' });
    expect(balanceResult.isErr()).toBe(true);
    if (!balanceResult.isErr()) {
      return;
    }

    expect(balanceResult.error.message).toContain('Failed to fetch KuCoin trade account balance');
  });
});
