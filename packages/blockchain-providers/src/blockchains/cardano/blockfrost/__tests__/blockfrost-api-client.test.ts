import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OneShotOperation, RawBalanceData } from '../../../../core/index.js';
import { ProviderRegistry } from '../../../../core/index.js';
import { BlockfrostApiClient } from '../blockfrost-api-client.js';
import type { BlockfrostAddress } from '../blockfrost.schemas.js';

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
  maskAddress: (address: string) => (address.length > 8 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('BlockfrostApiClient', () => {
  let client: BlockfrostApiClient;
  let mockHttpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient.get = vi.fn();
    mockHttpClient.request = vi.fn();
    mockHttpClient.getRateLimitStatus = vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    }));

    // Set API key for tests
    process.env.BLOCKFROST_API_KEY = 'test-api-key-123';

    const config = ProviderRegistry.createDefaultConfig('cardano', 'blockfrost');
    client = new BlockfrostApiClient(config);
    Object.defineProperty(client, 'httpClient', {
      configurable: true,
      value: mockHttpClient,
      writable: true,
    });
    mockHttpGet = mockHttpClient.get;
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeInstanceOf(BlockfrostApiClient);
      expect(client.blockchain).toBe('cardano');
      expect(client.name).toBe('blockfrost');
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(10);
      expect(rateLimit.burstLimit).toBe(500);
      expect(rateLimit.requestsPerMinute).toBe(600);
      expect(rateLimit.requestsPerHour).toBe(36000);
    });

    it('should require API key', () => {
      const config = ProviderRegistry.createDefaultConfig('cardano', 'blockfrost');
      const newClient = new BlockfrostApiClient(config);
      expect(newClient).toBeDefined();
    });
  });

  describe('getAddressBalances', () => {
    const mockAddress = 'addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2';

    const mockBalance: BlockfrostAddress = {
      address: mockAddress,
      amount: [{ quantity: '5000000', unit: 'lovelace' }],
      script: false,
      stake_address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
      type: 'shelley',
    };

    it('should fetch balance successfully', async () => {
      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/addresses/${mockAddress}`,
        expect.objectContaining({
          headers: { project_id: 'test-api-key-123' },
        })
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          decimalAmount: '5',
          decimals: 6,
          rawAmount: '5000000',
          symbol: 'ADA',
        });
      }
    });

    it('should handle zero balance', async () => {
      const zeroBalance: BlockfrostAddress = {
        address: mockAddress,
        amount: [{ quantity: '0', unit: 'lovelace' }],
        script: false,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(zeroBalance));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          decimalAmount: '0',
          decimals: 6,
          rawAmount: '0',
          symbol: 'ADA',
        });
      }
    });

    it('should handle Byron addresses', async () => {
      const byronAddress = 'DdzFFzCqrhsyLWVXEd1gB3UgcPMFrN7e7rZgFpZ1V2EYdqPwXU';
      const byronBalance: BlockfrostAddress = {
        address: byronAddress,
        amount: [{ quantity: '2000000', unit: 'lovelace' }],
        script: false,
        type: 'byron',
      };

      mockHttpGet.mockResolvedValue(ok(byronBalance));

      const operation: OneShotOperation = {
        address: byronAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.decimalAmount).toBe('2');
        expect(result.value.symbol).toBe('ADA');
      }
    });

    it('should handle script addresses', async () => {
      const scriptAddress = 'addr1w9s0adfja0s9dfjasd0f9jasdf09jasdf0jasdf0jasd0f';
      const scriptBalance: BlockfrostAddress = {
        address: scriptAddress,
        amount: [{ quantity: '1000000', unit: 'lovelace' }],
        script: true,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(scriptBalance));

      const operation: OneShotOperation = {
        address: scriptAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.decimalAmount).toBe('1');
      }
    });

    it('should handle addresses with stake delegation', async () => {
      const stakedBalance: BlockfrostAddress = {
        address: mockAddress,
        amount: [{ quantity: '3000000', unit: 'lovelace' }],
        script: false,
        stake_address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(stakedBalance));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.decimalAmount).toBe('3');
      }
    });

    it('should handle very large balances', async () => {
      const largeBalance: BlockfrostAddress = {
        address: mockAddress,
        amount: [{ quantity: '45000000000000', unit: 'lovelace' }], // 45M ADA
        script: false,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(largeBalance));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.decimalAmount).toBe('45000000');
        expect(result.value.decimalAmount).not.toContain('e'); // No scientific notation
      }
    });

    it('should handle dust amounts (single lovelace)', async () => {
      const dustBalance: BlockfrostAddress = {
        address: mockAddress,
        amount: [{ quantity: '1', unit: 'lovelace' }],
        script: false,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(dustBalance));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.decimalAmount).toBe('0.000001');
        expect(result.value.rawAmount).toBe('1');
      }
    });

    it('should handle missing lovelace amount (returns zero)', async () => {
      const noLovelace: BlockfrostAddress = {
        address: mockAddress,
        amount: [{ quantity: '1000', unit: 'policyId123assetName' }], // Only native token
        script: false,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(noLovelace));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // When lovelace is missing, return zero balance
        expect(result.value.decimalAmount).toBe('0');
        expect(result.value.rawAmount).toBe('0');
        expect(result.value.symbol).toBe('ADA');
      }
    });

    it('should handle API errors', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });

    it('should handle invalid response schema', async () => {
      // With HTTP client schema validation, invalid data is rejected by the HTTP client
      mockHttpGet.mockResolvedValue(err(new Error('Schema validation failed')));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Schema validation failed');
      }
    });

    it('should handle empty amount array (zero balance)', async () => {
      const emptyAmount = {
        address: mockAddress,
        amount: [], // Empty array indicates zero balance
        script: false,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(emptyAmount));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Empty amount array means zero balance
        expect(result.value.decimalAmount).toBe('0');
        expect(result.value.rawAmount).toBe('0');
        expect(result.value.symbol).toBe('ADA');
      }
    });

    it('should handle invalid quantity format', async () => {
      // With HTTP client schema validation, invalid quantity format is rejected by the HTTP client
      mockHttpGet.mockResolvedValue(err(new Error('Schema validation failed: quantity must be numeric')));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Schema validation failed');
      }
    });

    it('should handle addresses with multiple assets (ADA + native tokens)', async () => {
      const multiAsset: BlockfrostAddress = {
        address: mockAddress,
        amount: [
          { quantity: '5000000', unit: 'lovelace' },
          { quantity: '100', unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e' },
        ],
        script: false,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(multiAsset));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should extract only ADA balance
        expect(result.value.decimalAmount).toBe('5');
        expect(result.value.symbol).toBe('ADA');
      }
    });

    it('should handle undefined stake_address', async () => {
      const noStake: BlockfrostAddress = {
        address: mockAddress,
        amount: [{ quantity: '1000000', unit: 'lovelace' }],
        script: false,
        stake_address: undefined,
        type: 'shelley',
      };

      mockHttpGet.mockResolvedValue(ok(noStake));

      const operation: OneShotOperation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.decimalAmount).toBe('1');
      }
    });
  });

  describe('execute', () => {
    it('should return error for unsupported operation', async () => {
      const result = await client.execute({
        address: 'addr1...',
        type: 'unsupportedOperation' as const,
      } as unknown as OneShotOperation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Unsupported operation: unsupportedOperation');
      }
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should return valid health check configuration', () => {
      const config = client.getHealthCheckConfig();

      expect(config.endpoint).toBe('/health');
      expect(config.validate).toBeDefined();
    });

    it('should validate health check response', () => {
      const config = client.getHealthCheckConfig();

      expect(config.validate({ is_healthy: true })).toBe(true);
      expect(config.validate({})).toBe(false);
      expect(config.validate(void 0)).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('should have correct capabilities', () => {
      const capabilities = client.capabilities;

      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toContain('hasAddressTransactions');
      expect(capabilities.supportedOperations).toHaveLength(3);
      expect(capabilities.supportedTransactionTypes).toContain('normal');
    });
  });
});
