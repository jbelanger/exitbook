import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IExchangeClient } from '../../../core/types.js';
import { createCoinbaseClient } from '../client.js';

// Mock ccxt
vi.mock('ccxt', () => {
  const mockCoinbaseAdvanced = vi.fn();
  return {
    coinbaseadvanced: mockCoinbaseAdvanced,
  };
});

describe('createCoinbaseClient - Factory', () => {
  test('creates client with valid credentials', () => {
    const credentials = {
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isOk()).toBe(true);
  });

  test('returns error with missing apiKey', () => {
    const credentials = {
      secret: 'test-secret',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid coinbase credentials');
    }
  });

  test('returns error with missing secret', () => {
    const credentials = {
      apiKey: 'test-api-key',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid coinbase credentials');
    }
  });

  test('returns error with empty apiKey', () => {
    const credentials = {
      apiKey: '',
      secret: 'test-secret',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid coinbase credentials');
    }
  });

  test('returns error with malformed apiKey (missing /apiKeys/ path)', () => {
    const credentials = {
      apiKey: 'test-api-key', // Missing organizations/{org_id}/apiKeys/{key_id} format
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid Coinbase API key format');
      expect(result.error.message).toContain('/apiKeys/');
    }
  });

  test('returns error with non-ECDSA private key', () => {
    const credentials = {
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN PRIVATE KEY-----\nMHcCAQEEITest123\n-----END PRIVATE KEY-----', // Not EC PRIVATE KEY
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid Coinbase private key format');
      expect(result.error.message).toContain('ECDSA');
    }
  });

  test('normalizes PEM key with escaped newlines', () => {
    const credentials = {
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN EC PRIVATE KEY-----\\nMHcCAQEEITest123\\n-----END EC PRIVATE KEY-----', // Escaped newlines
    };

    const result = createCoinbaseClient(credentials);
    // Should succeed - normalization handles escaped newlines
    expect(result.isOk()).toBe(true);
  });
});

describe('createCoinbaseClient - fetchBalance', () => {
  let client: IExchangeClient;
  let mockFetchBalance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchBalance = vi.fn();

    (ccxt.coinbaseadvanced as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchBalance: mockFetchBalance,
    }));

    const result = createCoinbaseClient({
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...test...==\n-----END EC PRIVATE KEY-----',
    });

    if (result.isErr()) {
      throw new Error(`Failed to create client in test setup: ${result.error.message}`);
    }

    client = result.value;
  });

  test('fetches and returns balances', async () => {
    const mockBalance = {
      BTC: { free: 0.5, used: 0.1, total: 0.6 },
      USD: { free: 5000, used: 0, total: 5000 },
      ETH: { free: 5, used: 1, total: 6 },
      info: { someMetadata: 'value' },
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances, timestamp } = result.value;
    expect(balances.BTC).toBe('0.6');
    expect(balances.USD).toBe('5000');
    expect(balances.ETH).toBe('6');
    expect(balances.info).toBeUndefined();
    expect(timestamp).toBeGreaterThan(0);
  });

  test('skips zero balances', async () => {
    const mockBalance = {
      BTC: { free: 0.5, used: 0, total: 0.5 },
      USD: { free: 0, used: 0, total: 0 },
      ETH: { free: 0, used: 0, total: 0 },
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(balances.BTC).toBe('0.5');
    expect(balances.USD).toBeUndefined();
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
    mockFetchBalance.mockRejectedValueOnce(new Error('Unauthorized'));

    const result = await client.fetchBalance();

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toBeTruthy();
  });
});
