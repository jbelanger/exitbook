import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderOperation } from '../../../../shared/blockchain/index.js';
import { ProviderRegistry } from '../../../../shared/blockchain/index.js';
import { NearDataApiClient } from '../neardata.api-client.js';
import type { NearDataAccountResponse, NearDataTransaction } from '../neardata.schemas.js';

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

describe('NearDataApiClient', () => {
  let client: NearDataApiClient;
  let mockHttpPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient.get = vi.fn();
    mockHttpClient.post = vi.fn();
    mockHttpClient.request = vi.fn();
    mockHttpClient.getRateLimitStatus = vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    }));
    const config = ProviderRegistry.createDefaultConfig('near', 'neardata');
    client = new NearDataApiClient(config);
    Object.defineProperty(client, 'httpClient', {
      configurable: true,
      value: mockHttpClient,
      writable: true,
    });
    mockHttpPost = mockHttpClient.post;
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeInstanceOf(NearDataApiClient);
      expect(client.blockchain).toBe('near');
      expect(client.name).toBe('neardata');
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(1);
      expect(rateLimit.burstLimit).toBe(3);
      expect(rateLimit.requestsPerMinute).toBe(30);
      expect(rateLimit.requestsPerHour).toBe(500);
    });

    it('should not require API key', () => {
      const config = ProviderRegistry.createDefaultConfig('near', 'neardata');
      const newClient = new NearDataApiClient(config);
      expect(newClient).toBeDefined();
    });
  });

  describe('getAddressTransactions', () => {
    const mockAddress = 'alice.near';

    const mockTransaction: NearDataTransaction = {
      actions: [
        {
          action_kind: 'TRANSFER',
          deposit: '100000000000000000000000',
        },
      ],
      block_hash: 'ABC123DEF456',
      block_height: 100000,
      block_timestamp: 1640000000000000000,
      outcome: {
        execution_outcome: {
          block_hash: 'ABC123DEF456',
          id: 'receipt-1',
          outcome: {
            executor_id: 'bob.near',
            gas_burnt: 4174947687500,
            status: { SuccessValue: '' },
            tokens_burnt: '5000000000000000000000',
          },
        },
      },
      receiver_id: 'bob.near',
      signer_id: 'alice.near',
      tx_hash: 'AbCdEf123456',
    };

    it('should fetch transactions successfully', async () => {
      const mockResponse: NearDataAccountResponse = [mockTransaction];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpPost).toHaveBeenCalledWith('/v0/account', {
        account_id: mockAddress,
        max_block_height: undefined,
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const txData = result.value as { normalized: unknown; raw: unknown }[];
        expect(txData[0]?.normalized).toMatchObject({
          amount: '100000000000000000000000',
          currency: 'NEAR',
          from: 'alice.near',
          id: 'AbCdEf123456',
          providerName: 'neardata',
          status: 'success',
          timestamp: 1640000000000,
          to: 'bob.near',
        });
        expect(txData[0]?.raw).toEqual(mockTransaction);
      }
    });

    it('should handle multiple transactions', async () => {
      const mockResponse: NearDataAccountResponse = [
        mockTransaction,
        { ...mockTransaction, tx_hash: 'Tx2' },
        { ...mockTransaction, tx_hash: 'Tx3' },
      ];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
      }
    });

    it('should handle empty transactions array', async () => {
      const mockResponse: NearDataAccountResponse = [];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should use maxBlockHeight parameter when provided', async () => {
      const mockResponse: NearDataAccountResponse = [mockTransaction];
      const maxBlockHeight = 50000;

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation, { maxBlockHeight });

      expect(mockHttpPost).toHaveBeenCalledWith('/v0/account', {
        account_id: mockAddress,
        max_block_height: maxBlockHeight,
      });
      expect(result.isOk()).toBe(true);
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
      expect(mockHttpPost).not.toHaveBeenCalled();
    });

    it('should return error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpPost.mockResolvedValue(err(error));

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

    it('should return error for invalid response schema', async () => {
      const invalidResponse = [
        {
          tx_hash: '',
          block_timestamp: 1640000000000000000,
          signer_id: 'alice.near',
          receiver_id: 'bob.near',
        },
      ];

      mockHttpPost.mockResolvedValue(ok(invalidResponse));

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

      const mockResponse: NearDataAccountResponse = [
        {
          ...mockTransaction,
          signer_id: implicitAddress,
        },
      ];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: implicitAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpPost).toHaveBeenCalledWith('/v0/account', {
        account_id: implicitAddress,
        max_block_height: undefined,
      });
      expect(result.isOk()).toBe(true);
    });

    it('should handle transaction with minimal fields', async () => {
      const minimalTx: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'MinimalTx',
      };

      const mockResponse: NearDataAccountResponse = [minimalTx];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const txData = result.value as { normalized: unknown; raw: unknown }[];
        expect(txData[0]?.normalized).toMatchObject({
          amount: '0',
          id: 'MinimalTx',
          status: 'pending',
        });
      }
    });

    it('should handle failed transaction', async () => {
      const failedTx: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'bob.near',
              gas_burnt: 1000000,
              status: { Failure: { error: 'execution failed' } },
              tokens_burnt: '1000000000000000000000',
            },
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'FailedTx',
      };

      const mockResponse: NearDataAccountResponse = [failedTx];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const txData = result.value as { normalized: unknown; raw: unknown }[];
        expect(txData[0]?.normalized).toMatchObject({
          status: 'failed',
        });
      }
    });

    it('should handle function call transaction', async () => {
      const functionCallTx: NearDataTransaction = {
        actions: [
          {
            action_kind: 'FUNCTION_CALL',
            args: { receiver_id: 'token.near', amount: '1000000' },
            deposit: '1',
            gas: 30000000000000,
            method_name: 'ft_transfer',
          },
        ],
        block_hash: 'ABC123',
        block_height: 100001,
        block_timestamp: 1640000001000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'usdt.tether-token.near',
              gas_burnt: 3000000000000,
              status: { SuccessValue: '' },
              tokens_burnt: '3000000000000000000000',
            },
          },
        },
        receiver_id: 'usdt.tether-token.near',
        signer_id: 'alice.near',
        tx_hash: 'FunctionCallTx',
      };

      const mockResponse: NearDataAccountResponse = [functionCallTx];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const txData = result.value as { normalized: { actions?: unknown[] }; raw: unknown }[];
        expect(txData[0]?.normalized.actions).toHaveLength(1);
        expect(txData[0]?.normalized.actions?.[0]).toMatchObject({
          actionType: 'FUNCTION_CALL',
          methodName: 'ft_transfer',
        });
      }
    });

    it('should calculate fees correctly', async () => {
      const txWithFees: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'bob.near',
              gas_burnt: 4174947687500,
              status: { SuccessValue: '' },
              tokens_burnt: '5000000000000000000000',
            },
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'FeesTx',
      };

      const mockResponse: NearDataAccountResponse = [txWithFees];

      mockHttpPost.mockResolvedValue(ok(mockResponse));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const txData = result.value as { normalized: unknown; raw: unknown }[];
        expect(txData[0]?.normalized).toMatchObject({
          feeAmount: '0.005',
          feeCurrency: 'NEAR',
        });
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

      expect(config.endpoint).toBe('/v0/account');
      expect(config.method).toBe('POST');
      expect(config.body).toEqual({
        account_id: 'near',
        max_block_height: undefined,
      });
      expect(config.validate).toBeDefined();
    });

    it('should validate health check response', () => {
      const config = client.getHealthCheckConfig();

      expect(config.validate([])).toBe(true);
      expect(config.validate([{ tx_hash: 'test' }])).toBe(true);
      expect(config.validate({})).toBe(false);
      expect(config.validate(void 0)).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('should have correct capabilities', () => {
      const capabilities = client.capabilities;

      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toHaveLength(1);
    });
  });
});
