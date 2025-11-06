import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderOperation, RawBalanceData } from '../../../../shared/blockchain/index.js';
import { ProviderRegistry } from '../../../../shared/blockchain/index.js';
import { NearBlocksApiClient } from '../nearblocks.api-client.js';
import type {
  NearBlocksAccount,
  NearBlocksTransaction,
  NearBlocksTransactionsResponse,
} from '../nearblocks.schemas.js';

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

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('NearBlocksApiClient', () => {
  let client: NearBlocksApiClient;
  let mockHttpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient.get = vi.fn();
    mockHttpClient.request = vi.fn();
    mockHttpClient.getRateLimitStatus = vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    }));
    const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
    client = new NearBlocksApiClient(config);
    Object.defineProperty(client, 'httpClient', {
      configurable: true,
      value: mockHttpClient,
      writable: true,
    });
    mockHttpGet = mockHttpClient.get;
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeInstanceOf(NearBlocksApiClient);
      expect(client.blockchain).toBe('near');
      expect(client.name).toBe('nearblocks');
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(2);
      expect(rateLimit.burstLimit).toBe(5);
      expect(rateLimit.requestsPerMinute).toBe(60);
      expect(rateLimit.requestsPerHour).toBe(1000);
    });

    it('should not require API key', () => {
      const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
      const newClient = new NearBlocksApiClient(config);
      expect(newClient).toBeDefined();
    });
  });

  describe('getAddressTransactions', () => {
    const mockAddress = 'alice.near';

    const mockTransaction: NearBlocksTransaction = {
      actions: [
        {
          action: 'TRANSFER',
          deposit: '1000000000000000000000000',
          from: 'alice.near',
          to: 'bob.near',
        },
      ],
      block_height: 100000,
      block_timestamp: '1640000000000000000',
      outcomes: {
        receipt1: {
          status: true,
          tokens_burnt: '5000000000000000000000',
        },
      },
      receiver_id: 'bob.near',
      signer_id: 'alice.near',
      transaction_hash: 'AbCdEf123456',
    };

    it('should fetch transactions successfully with pagination', async () => {
      const mockResponse: NearBlocksTransactionsResponse = {
        txns: [mockTransaction],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(`/v1/account/${mockAddress}/txns?page=1&per_page=50`);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const txData = result.value as { normalized: unknown; raw: unknown }[];
        expect(txData[0]?.normalized).toMatchObject({
          currency: 'NEAR',
          from: 'alice.near',
          id: 'AbCdEf123456',
          providerName: 'nearblocks',
          status: 'success',
          timestamp: 1640000000,
          to: 'bob.near',
        });
        expect(txData[0]?.raw).toEqual(mockTransaction);
      }
    });

    it('should handle multiple pages of transactions', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(50).fill(mockTransaction) as NearBlocksTransaction[],
      };

      const page2Response: NearBlocksTransactionsResponse = {
        txns: Array(30).fill({ ...mockTransaction, transaction_hash: 'Page2Tx' }) as NearBlocksTransaction[],
      };

      mockHttpGet.mockResolvedValueOnce(ok(page1Response)).mockResolvedValueOnce(ok(page2Response));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledTimes(2);
      expect(mockHttpGet).toHaveBeenNthCalledWith(1, `/v1/account/${mockAddress}/txns?page=1&per_page=50`);
      expect(mockHttpGet).toHaveBeenNthCalledWith(2, `/v1/account/${mockAddress}/txns?page=2&per_page=50`);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(80); // 50 + 30
      }
    });

    it('should stop pagination when receiving less than full page', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(30).fill(mockTransaction) as NearBlocksTransaction[],
      };

      mockHttpGet.mockResolvedValueOnce(ok(page1Response));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledTimes(1);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(30);
      }
    });

    it('should stop pagination when receiving empty transactions', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(50).fill(mockTransaction) as NearBlocksTransaction[],
      };

      const page2Response: NearBlocksTransactionsResponse = {
        txns: [],
      };

      mockHttpGet.mockResolvedValueOnce(ok(page1Response)).mockResolvedValueOnce(ok(page2Response));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledTimes(2);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(50);
      }
    });

    it('should respect max pages limit (20 pages)', async () => {
      const fullPageResponse: NearBlocksTransactionsResponse = {
        txns: Array(50).fill(mockTransaction) as NearBlocksTransaction[],
      };

      mockHttpGet.mockResolvedValue(ok(fullPageResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledTimes(20); // Max 20 pages
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1000); // 20 * 50
      }
    });

    it('should return error if first page fails', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });

    it('should continue with partial results if subsequent page fails', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(50).fill(mockTransaction) as NearBlocksTransaction[],
      };

      mockHttpGet.mockResolvedValueOnce(ok(page1Response)).mockResolvedValueOnce(err(new Error('Page 2 failed')));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledTimes(2);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(50); // Only page 1
      }
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const operation = {
        address: invalidAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid NEAR account ID');
      }
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('should return error for invalid response schema', async () => {
      const invalidResponse = {
        txns: [
          {
            transaction_hash: '', // Invalid: empty
            block_timestamp: '1640000000000000000',
            signer_id: 'alice.near',
            receiver_id: 'bob.near',
          },
        ],
      };

      mockHttpGet.mockResolvedValue(ok(invalidResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Provider data validation failed');
      }
    });

    it('should handle implicit account addresses', async () => {
      const implicitAddress = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';

      const mockResponse: NearBlocksTransactionsResponse = {
        txns: [
          {
            ...mockTransaction,
            signer_id: implicitAddress,
          },
        ],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: implicitAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(`/v1/account/${implicitAddress}/txns?page=1&per_page=50`);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('getAddressBalances', () => {
    const mockAddress = 'alice.near';

    const mockBalance: NearBlocksAccount = {
      account_id: 'alice.near',
      amount: '1000000000000000000000000',
      block_height: 100000,
    };

    it('should fetch balance successfully', async () => {
      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(`/v1/account/${mockAddress}`);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          decimals: 24,
          decimalAmount: '1',
          rawAmount: '1000000000000000000000000',
          symbol: 'NEAR',
        });
      }
    });

    it('should handle zero balance', async () => {
      const zeroBalance: NearBlocksAccount = {
        account_id: 'alice.near',
        amount: '0',
      };

      mockHttpGet.mockResolvedValue(ok(zeroBalance));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          decimals: 24,
          decimalAmount: '0',
          rawAmount: '0',
          symbol: 'NEAR',
        });
      }
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
        account_id: '',
        amount: '1000000000000000000000000',
      };

      mockHttpGet.mockResolvedValue(ok(invalidResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid account data from NearBlocks');
      }
    });

    it('should handle implicit account addresses', async () => {
      const implicitAddress = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';

      const mockBalance: NearBlocksAccount = {
        account_id: implicitAddress,
        amount: '500000000000000000000000',
      };

      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const operation = {
        address: implicitAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(`/v1/account/${implicitAddress}`);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          decimals: 24,
          decimalAmount: '0.5',
          rawAmount: '500000000000000000000000',
          symbol: 'NEAR',
        });
      }
    });

    it('should handle very large balances', async () => {
      const largeBalance: NearBlocksAccount = {
        account_id: 'alice.near',
        amount: '1000000000000000000000000000000',
      };

      mockHttpGet.mockResolvedValue(ok(largeBalance));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute<RawBalanceData>(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.decimalAmount).toBe('1000000');
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

      expect(config.endpoint).toBe('/v1/stats');
      expect(config.method).toBe('GET');
      expect(config.validate).toBeDefined();
    });

    it('should validate health check response', () => {
      const config = client.getHealthCheckConfig();

      expect(config.validate({ stats: 'data' })).toBe(true);
      expect(config.validate({})).toBe(true);
      expect(config.validate()).toBe(false);
      expect(config.validate()).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('should have correct capabilities', () => {
      const capabilities = client.capabilities;

      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toHaveLength(2);
    });
  });
});
