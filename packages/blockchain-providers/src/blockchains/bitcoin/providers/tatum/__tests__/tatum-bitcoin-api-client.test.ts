/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import { ok, err } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderOperation } from '../../../../../core/index.js';
import { ProviderRegistry } from '../../../../../core/index.js';
import { TatumBitcoinApiClient } from '../tatum-bitcoin.api-client.js';
import type { TatumBitcoinTransaction, TatumBitcoinBalance } from '../tatum.schemas.js';

const mockHttpClient = {
  get: vi.fn(),
  getRateLimitStatus: vi.fn(() => ({
    remainingRequests: 10,
    resetTime: Date.now() + 60000,
  })),
  request: vi.fn(),
};

vi.mock('@exitbook/shared-utils', () => ({
  HttpClient: vi.fn(() => mockHttpClient),
  maskAddress: (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`,
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.stubEnv('TATUM_API_KEY', 'test-api-key');

describe('TatumBitcoinApiClient', () => {
  let client: TatumBitcoinApiClient;
  let mockHttpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient.get = vi.fn();
    mockHttpClient.request = vi.fn();
    mockHttpClient.getRateLimitStatus = vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    }));
    const config = ProviderRegistry.createDefaultConfig('bitcoin', 'tatum');
    client = new TatumBitcoinApiClient(config);
    Object.defineProperty(client, 'httpClient', {
      configurable: true,
      value: mockHttpClient,
      writable: true,
    });
    mockHttpGet = mockHttpClient.get;
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeInstanceOf(TatumBitcoinApiClient);
      expect(client.blockchain).toBe('bitcoin');
      expect(client.name).toBe('tatum');
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(3);
      expect(rateLimit.burstLimit).toBe(50);
      expect(rateLimit.requestsPerMinute).toBe(180);
    });
  });

  describe('getAddressBalances', () => {
    const mockAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    const mockBalance: TatumBitcoinBalance = {
      incoming: '5000000000',
      outgoing: '1000000000',
    };

    it('should fetch balance successfully', async () => {
      mockHttpGet.mockResolvedValueOnce(ok(mockBalance)); // Call for balance

      const result = await client.getAddressBalances(mockAddress);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/address/balance/${mockAddress}`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          rawAmount: '4000000000', // 5000000000 - 1000000000
          symbol: 'BTC',
          decimals: 8,
          decimalAmount: '40', // (5000000000 - 1000000000) / 100000000
        });
      }
    });

    it('should throw error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const result = await client.getAddressBalances(mockAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });
  });

  describe('execute', () => {
    const mockAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    it('should execute getAddressTransactions operation', async () => {
      const mockTransactions: TatumBitcoinTransaction[] = [];
      mockHttpGet.mockResolvedValue(ok(mockTransactions));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const results: TatumBitcoinTransaction[] = [];
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          results.push(...result.value.data.map((item) => item.raw as TatumBitcoinTransaction));
        }
      }

      expect(results).toEqual(mockTransactions);
    });

    it('should execute getAddressBalances operation', async () => {
      const mockBalance: TatumBitcoinBalance = {
        incoming: '5000000000',
        outgoing: '1000000000',
      };

      mockHttpGet.mockResolvedValueOnce(ok(mockBalance)); // Call for balance

      const result = await client.execute({
        address: mockAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          rawAmount: '4000000000', // 5000000000 - 1000000000
          symbol: 'BTC',
          decimals: 8,
          decimalAmount: '40', // (5000000000 - 1000000000) / 100000000
        });
      }
    });

    it('should throw error for unsupported operation', async () => {
      const result = await client.execute({
        address: mockAddress,
        type: 'unsupportedOperation' as const,
      } as unknown as ProviderOperation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Unsupported operation: unsupportedOperation');
      }
    });
  });

  describe('isHealthy', () => {
    it('should return true when API is healthy', async () => {
      const mockBalance: TatumBitcoinBalance = {
        incoming: '0',
        outgoing: '0',
      };
      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const result = await client.isHealthy();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
      expect(mockHttpGet).toHaveBeenCalledWith('/address/balance/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    });

    it('should return false when API is unhealthy', async () => {
      mockHttpGet.mockResolvedValue(err(new Error('API Error')));

      const result = await client.isHealthy();

      expect(result.isErr()).toBe(true);
    });
  });

  describe('capabilities', () => {
    it('should have correct capabilities', () => {
      const capabilities = client.capabilities;

      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedTransactionTypes).toContain('normal');
    });
  });
});
