/* eslint-disable unicorn/no-null -- FastNear API returns null for empty fields, tests must match actual API behavior */
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderOperation, RawBalanceData } from '../../../../shared/blockchain/index.js';
import { ProviderRegistry } from '../../../../shared/blockchain/index.js';
import { FastNearApiClient } from '../fastnear.api-client.js';
import type { FastNearAccountFullResponse } from '../fastnear.schemas.js';

const mockHttpClient = {
  get: vi.fn(),
  getRateLimitStatus: vi.fn(() => ({
    remainingRequests: 10,
    resetTime: Date.now() + 60000,
  })),
  post: vi.fn(),
  request: vi.fn(),
};

vi.mock('@exitbook/shared-utils', () => ({
  HttpClient: vi.fn(() => mockHttpClient),
  maskAddress: (address: string) => (address.length > 8 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address),
}));

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('FastNearApiClient', () => {
  let client: FastNearApiClient;
  let mockHttpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient.get = vi.fn();
    mockHttpClient.post = vi.fn();
    mockHttpClient.request = vi.fn();
    mockHttpClient.getRateLimitStatus = vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    }));
    const config = ProviderRegistry.createDefaultConfig('near', 'fastnear');
    client = new FastNearApiClient(config);
    Object.defineProperty(client, 'httpClient', {
      configurable: true,
      value: mockHttpClient,
      writable: true,
    });
    mockHttpGet = mockHttpClient.get;
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeInstanceOf(FastNearApiClient);
      expect(client.blockchain).toBe('near');
      expect(client.name).toBe('fastnear');
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(2);
      expect(rateLimit.burstLimit).toBe(5);
      expect(rateLimit.requestsPerMinute).toBe(60);
      expect(rateLimit.requestsPerHour).toBe(1000);
    });

    it('should not require API key', () => {
      const config = ProviderRegistry.createDefaultConfig('near', 'fastnear');
      const newClient = new FastNearApiClient(config);
      expect(newClient).toBeDefined();
    });
  });

  describe('getAddressBalances', () => {
    const mockAddress = 'alice.near';

    it('should fetch native NEAR balance successfully', async () => {
      const mockResponse: FastNearAccountFullResponse = {
        account: {
          account_id: 'alice.near',
          amount: '5000000000000000000000000',
          block_hash: 'ABC123',
          block_height: 123456789,
        },
        ft: [
          {
            balance: '1000000',
            contract_id: 'usdt.tether-token.near',
            last_update_block_height: 123456789,
          },
        ],
        nft: [
          {
            contract_id: 'paras-token-v2.near',
            last_update_block_height: 123456789,
          },
        ],
        staking: [
          {
            last_update_block_height: 123456789,
            pool_id: 'astro-stakers.poolv1.near',
          },
        ],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(`/v1/account/${mockAddress}/full`);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value as RawBalanceData;
        expect(balance).toMatchObject({
          decimalAmount: '5',
          decimals: 24,
          rawAmount: '5000000000000000000000000',
          symbol: 'NEAR',
        });
      }
    });

    it('should handle account with only native balance', async () => {
      const mockResponse: FastNearAccountFullResponse = {
        account: {
          account_id: 'bob.near',
          amount: '2500000000000000000000000',
        },
        ft: null,
        nft: null,
        staking: null,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: 'bob.near',
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value as RawBalanceData;
        expect(balance).toEqual({
          decimalAmount: '2.5',
          decimals: 24,
          rawAmount: '2500000000000000000000000',
          symbol: 'NEAR',
        });
      }
    });

    it('should handle account with no native balance (returns zero)', async () => {
      const mockResponse: FastNearAccountFullResponse = {
        account: null,
        ft: [
          {
            balance: '1000000',
            contract_id: 'usdc.near',
            last_update_block_height: 123456789,
          },
        ],
        nft: null,
        staking: null,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value as RawBalanceData;
        expect(balance).toEqual({
          decimalAmount: '0',
          decimals: 24,
          rawAmount: '0',
          symbol: 'NEAR',
        });
      }
    });

    it('should handle empty account (all null, returns zero balance)', async () => {
      const mockResponse: FastNearAccountFullResponse = {
        account: null,
        ft: null,
        nft: null,
        staking: null,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value as RawBalanceData;
        expect(balance).toEqual({
          decimalAmount: '0',
          decimals: 24,
          rawAmount: '0',
          symbol: 'NEAR',
        });
      }
    });

    it('should handle implicit account addresses', async () => {
      const implicitAddress = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';

      const mockResponse: FastNearAccountFullResponse = {
        account: {
          account_id: implicitAddress,
          amount: '1000000000000000000000000',
        },
        ft: null,
        nft: null,
        staking: null,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: implicitAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(`/v1/account/${implicitAddress}/full`);
      expect(result.isOk()).toBe(true);
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const operation = {
        address: invalidAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid NEAR account ID');
      }
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('should return error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });

    it('should return error for invalid response schema', async () => {
      const invalidResponse = {
        account: 'not-an-object',
        ft: 'not-an-array',
      };

      mockHttpGet.mockResolvedValue(ok(invalidResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Provider data validation failed');
      }
    });

    it('should handle zero balance', async () => {
      const mockResponse: FastNearAccountFullResponse = {
        account: {
          account_id: 'empty.near',
          amount: '0',
        },
        ft: null,
        nft: null,
        staking: null,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: 'empty.near',
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value as RawBalanceData;
        expect(balance).toEqual({
          decimalAmount: '0',
          decimals: 24,
          rawAmount: '0',
          symbol: 'NEAR',
        });
      }
    });

    it('should handle large balance values', async () => {
      const mockResponse: FastNearAccountFullResponse = {
        account: {
          account_id: 'whale.near',
          amount: '999999999999999999999999999',
        },
        ft: null,
        nft: null,
        staking: null,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: 'whale.near',
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value as RawBalanceData;
        expect(balance.rawAmount).toBe('999999999999999999999999999');
        // 999999999999999999999999999 yoctoNEAR / 10^24 = 999.999999999999999999999999 NEAR
        expect(balance.decimalAmount).toBe('999.999999999999999999999999');
        expect(balance.symbol).toBe('NEAR');
        expect(balance.decimals).toBe(24);
      }
    });
  });

  describe('execute', () => {
    it('should return error for unsupported operation', async () => {
      const result = await client.execute({
        address: 'alice.near',
        type: 'unsupportedOperation' as const,
      } as unknown as ProviderOperation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Unsupported operation: unsupportedOperation');
      }
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should return valid health check configuration', () => {
      const config = client.getHealthCheckConfig();

      expect(config.endpoint).toBe('/v1/account/near/full');
      expect(config.method).toBe('GET');
      expect(config.validate).toBeDefined();
    });

    it('should validate health check response', () => {
      const config = client.getHealthCheckConfig();

      expect(config.validate({ account: null, ft: null, nft: null, staking: undefined })).toBe(true);
      expect(config.validate({})).toBe(true);
      expect(config.validate(null)).toBe(false);
      expect(config.validate(void 0)).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('should have correct capabilities', () => {
      const capabilities = client.capabilities;

      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toHaveLength(1);
    });
  });
});
