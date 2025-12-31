/* eslint-disable unicorn/no-null -- acceptable for tests */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RawBalanceData, ProviderOperation } from '../../../../../core/index.ts';
import { ProviderRegistry } from '../../../../../core/index.ts';
import type { NearTransaction } from '../../../schemas.ts';
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

vi.mock('@exitbook/logger', () => ({
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
    // Disable rate limiting for tests to prevent timeouts
    config.rateLimit = {
      requestsPerSecond: 1000,
      burstLimit: 1000,
      requestsPerMinute: 60000,
      requestsPerHour: 3600000,
    };
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
      expect(rateLimit.requestsPerSecond).toBe(0.1);
      expect(rateLimit.burstLimit).toBe(1);
      expect(rateLimit.requestsPerMinute).toBe(6);
      expect(rateLimit.requestsPerHour).toBe(250);
    });

    it('should not require API key', () => {
      const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
      config.rateLimit = {
        requestsPerSecond: 1000,
        burstLimit: 1000,
        requestsPerMinute: 60000,
        requestsPerHour: 3600000,
      };
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
          args: undefined,
          deposit: '100000000000000000000',
          method: undefined,
        },
      ],
      block: {
        block_height: 100000,
      },
      block_timestamp: '1640000000000000000',
      outcomes: {
        status: true,
      },
      signer_account_id: 'alice.near',
      receipt_outcome: {
        executor_account_id: 'bob.near',
        gas_burnt: '4174947687500',
        status: true,
        tokens_burnt: '5000000000000000000000',
      },
      receiver_account_id: 'bob.near',
      transaction_hash: 'AbCdEf123456',
    };

    it('should fetch transactions successfully with pagination', async () => {
      const mockResponse: NearBlocksTransactionsResponse = {
        txns: [mockTransaction],
      };

      // Mock responses for all enrichment endpoints
      mockHttpGet.mockImplementation((url: string) => {
        if (url.includes('/txns-only')) {
          return Promise.resolve(ok(mockResponse));
        }
        if (url.includes('/activities')) {
          return Promise.resolve(ok({ activities: [] }));
        }
        if (url.includes('/receipts')) {
          return Promise.resolve(ok({ txns: [] }));
        }
        return Promise.resolve(err(new Error(`Unexpected URL: ${url}`)));
      });

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: { normalized: unknown; raw: unknown }[] = [];
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(allTransactions).toHaveLength(1);
      expect(allTransactions[0]?.normalized).toMatchObject({
        currency: 'NEAR',
        from: 'alice.near',
        id: 'AbCdEf123456',
        providerName: 'nearblocks',
        status: 'success',
        timestamp: 1640000000000,
        to: 'bob.near',
      });
      expect(allTransactions[0]?.raw).toEqual(mockTransaction);
    });

    it('should handle multiple pages of transactions', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(25)
          .fill(null)
          .map((_, idx) => ({ ...mockTransaction, transaction_hash: `page1_tx${idx}` })) as NearBlocksTransaction[],
      };

      const page2Response: NearBlocksTransactionsResponse = {
        txns: Array(20)
          .fill(null)
          .map((_, idx) => ({ ...mockTransaction, transaction_hash: `page2_tx${idx}` })) as NearBlocksTransaction[],
      };

      mockHttpGet
        .mockResolvedValueOnce(ok(page1Response))
        .mockResolvedValueOnce(ok({ txns: [] })) // receipts page 1
        .mockResolvedValueOnce(ok({ activities: [] })) // activities enrichment
        .mockResolvedValueOnce(ok(page2Response))
        .mockResolvedValueOnce(ok({ txns: [] })) // receipts page 2
        .mockResolvedValueOnce(ok({ activities: [] })); // activities enrichment page 2

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: unknown[] = [];
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(allTransactions).toHaveLength(45); // 25 + 20
    });

    it('should stop pagination when receiving less than full page', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(20)
          .fill(null)
          .map((_, idx) => ({ ...mockTransaction, transaction_hash: `tx${idx}` })) as NearBlocksTransaction[],
      };

      mockHttpGet
        .mockResolvedValueOnce(ok(page1Response))
        .mockResolvedValueOnce(ok({ txns: [] })) // receipts enrichment
        .mockResolvedValueOnce(ok({ activities: [] })); // activities enrichment

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: unknown[] = [];
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(allTransactions).toHaveLength(20);
    });

    it('should stop pagination when receiving empty transactions', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(25)
          .fill(null)
          .map((_, idx) => ({ ...mockTransaction, transaction_hash: `tx${idx}` })) as NearBlocksTransaction[],
      };

      const page2Response: NearBlocksTransactionsResponse = {
        txns: [],
      };

      mockHttpGet
        .mockResolvedValueOnce(ok(page1Response))
        .mockResolvedValueOnce(ok({ txns: [] })) // receipts page 1
        .mockResolvedValueOnce(ok({ activities: [] })) // activities page 1
        .mockResolvedValueOnce(ok(page2Response)); // page 2 is empty

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: unknown[] = [];
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(allTransactions).toHaveLength(25);
    });

    it('should derive activity deltas when enrichment data lacks delta_nonstaked_amount', async () => {
      const transactionsResponse: NearBlocksTransactionsResponse = {
        txns: [mockTransaction],
      };

      const activitiesResponse = {
        activities: [
          {
            absolute_nonstaked_amount: '1000000000000000000000000',
            absolute_staked_amount: '0',
            affected_account_id: mockAddress,
            block_height: '12345678',
            block_timestamp: '1640000000000000000',
            cause: 'TRANSFER',
            direction: 'INBOUND' as const,
            event_index: '0',
            involved_account_id: 'bob.near',
            receipt_id: 'receipt123',
            transaction_hash: mockTransaction.transaction_hash,
          },
          {
            absolute_nonstaked_amount: '2000000000000000000000000',
            absolute_staked_amount: '0',
            affected_account_id: mockAddress,
            block_height: '12345679',
            block_timestamp: '1640000001000000000',
            cause: 'TRANSFER',
            direction: 'INBOUND' as const,
            event_index: '1',
            involved_account_id: 'bob.near',
            receipt_id: 'receipt456',
            transaction_hash: mockTransaction.transaction_hash,
          },
        ],
      };

      const receiptsResponse = {
        txns: [
          {
            block_timestamp: '1640000000000000000',
            predecessor_account_id: 'bob.near',
            receipt_id: 'receipt123',
            receiver_account_id: mockAddress,
            transaction_hash: mockTransaction.transaction_hash,
          },
          {
            block_timestamp: '1640000001000000000',
            predecessor_account_id: 'bob.near',
            receipt_id: 'receipt456',
            receiver_account_id: mockAddress,
            transaction_hash: mockTransaction.transaction_hash,
          },
        ],
      };

      mockHttpGet.mockImplementation((url: string) => {
        if (url.includes('/txns-only')) {
          return Promise.resolve(ok(transactionsResponse));
        }
        if (url.includes('/activities')) {
          if (url.includes('cursor=')) {
            return Promise.resolve(ok({ activities: [] }));
          }
          return Promise.resolve(ok(activitiesResponse));
        }
        if (url.includes('/receipts')) {
          if (url.includes('page=1')) {
            return Promise.resolve(ok(receiptsResponse));
          }
          return Promise.resolve(ok({ txns: [] }));
        }
        return Promise.resolve(err(new Error(`Unexpected URL: ${url}`)));
      });

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: { normalized: NearTransaction; raw: unknown }[] = [];
      for await (const result of client.executeStreaming<NearTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(allTransactions).toHaveLength(1);
      const accountChanges = allTransactions[0]?.normalized.accountChanges;
      expect(accountChanges).toBeDefined();
      expect(accountChanges).toHaveLength(2);
      const [firstChange, secondChange] = accountChanges ?? [];
      expect(firstChange?.postBalance).toBe('1000000000000000000000000');
      expect(firstChange?.preBalance).toBe('1000000000000000000000000');
      expect(secondChange?.postBalance).toBe('2000000000000000000000000');
      expect(secondChange?.preBalance).toBe('1000000000000000000000000');
    });

    it('should handle many pages of unique transactions', async () => {
      let pageCount = 0;
      const MAX_PAGES = 40;

      mockHttpGet.mockImplementation((url: string) => {
        if (url.includes('/activities')) {
          return Promise.resolve(ok({ activities: [] }));
        }
        if (url.includes('/receipts')) {
          return Promise.resolve(ok({ txns: [] }));
        }
        if (url.includes('/txns-only')) {
          pageCount++;
          // Return full pages until we hit the max, then return empty to stop
          if (pageCount > MAX_PAGES) {
            return Promise.resolve(ok({ txns: [] }));
          }
          // Return unique transactions for each page to avoid deduplication
          const fullPageResponse: NearBlocksTransactionsResponse = {
            txns: Array(25)
              .fill(null)
              .map((_, idx) => ({
                ...mockTransaction,
                transaction_hash: `tx_page${pageCount}_item${idx}`,
              })) as NearBlocksTransaction[],
          };
          return Promise.resolve(ok(fullPageResponse));
        }
        return Promise.resolve(ok({ txns: [] }));
      });

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: unknown[] = [];
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(allTransactions).toHaveLength(1000); // 40 pages * 25 transactions
    });

    it('should return error if first page fails', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      let hasError = false;
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toBe('API Error');
          hasError = true;
        }
      }
      expect(hasError).toBe(true);
    });

    it('should continue with partial results if subsequent page fails', async () => {
      const page1Response: NearBlocksTransactionsResponse = {
        txns: Array(25)
          .fill(null)
          .map((_, idx) => ({ ...mockTransaction, transaction_hash: `tx${idx}` })) as NearBlocksTransaction[],
      };

      mockHttpGet
        .mockResolvedValueOnce(ok(page1Response))
        .mockResolvedValueOnce(ok({ txns: [] })) // receipts page 1
        .mockResolvedValueOnce(ok({ activities: [] })) // activities page 1
        .mockResolvedValueOnce(err(new Error('Page 2 failed')));

      const operation = {
        address: mockAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: unknown[] = [];
      for await (const result of client.executeStreaming(operation)) {
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(allTransactions).toHaveLength(25); // Only page 1
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const operation = {
        address: invalidAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      let hasError = false;
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid NEAR account ID');
          hasError = true;
        }
      }
      expect(hasError).toBe(true);
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('should handle implicit account addresses', async () => {
      const implicitAddress = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';

      const mockResponse: NearBlocksTransactionsResponse = {
        txns: [
          {
            ...mockTransaction,
            signer_account_id: implicitAddress,
          },
        ],
      };

      // Mock responses for all endpoints (transactions + enrichment)
      mockHttpGet.mockImplementation((url: string) => {
        if (url.includes('/txns-only')) {
          return Promise.resolve(ok(mockResponse));
        }
        if (url.includes('/activities')) {
          return Promise.resolve(ok({ activities: [] }));
        }
        if (url.includes('/receipts')) {
          return Promise.resolve(ok({ txns: [] }));
        }
        return Promise.resolve(err(new Error(`Unexpected URL: ${url}`)));
      });

      const operation = {
        address: implicitAddress,
        type: 'getAddressTransactions' as const,
        transactionType: 'normal' as const,
      };

      const allTransactions: unknown[] = [];
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allTransactions.push(...result.value.data);
        }
      }

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${implicitAddress}/txns-only?page=1&per_page=25`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(allTransactions).toHaveLength(1);
    });
  });

  describe('getAddressBalances', () => {
    const mockAddress = 'alice.near';

    const mockBalance: NearBlocksAccount = {
      account: [
        {
          account_id: 'alice.near',
          amount: '1000000000000000000000000',
          block_height: 100000,
        },
      ],
    };

    it('should fetch balance successfully', async () => {
      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const operation = {
        address: mockAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${mockAddress}`,
        expect.objectContaining({ schema: expect.anything() })
      );
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
        account: [
          {
            account_id: 'alice.near',
            amount: '0',
          },
        ],
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

    it('should handle implicit account addresses', async () => {
      const implicitAddress = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';

      const mockBalance: NearBlocksAccount = {
        account: [
          {
            account_id: implicitAddress,
            amount: '500000000000000000000000',
          },
        ],
      };

      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const operation = {
        address: implicitAddress,
        type: 'getAddressBalances' as const,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${implicitAddress}`,
        expect.objectContaining({ schema: expect.anything() })
      );
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
        account: [
          {
            account_id: 'alice.near',
            amount: '1000000000000000000000000000000',
          },
        ],
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
      expect(config.validate(void 0)).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('should have correct capabilities', () => {
      const capabilities = client.capabilities;

      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toHaveLength(2);
      expect(capabilities.supportedTransactionTypes).toContain('normal');
      expect(capabilities.supportedTransactionTypes).toContain('token');
    });
  });

  describe('getAccountReceipts', () => {
    const mockAddress = 'alice.near';

    it('should fetch receipts successfully', async () => {
      const mockReceipts = [
        {
          transaction_hash: 'tx123',
          predecessor_account_id: 'alice.near',
          receipt_id: 'receipt123',
          receiver_account_id: 'bob.near',
        },
        {
          block_timestamp: '1640000000000000000',
          transaction_hash: 'tx456',
          predecessor_account_id: 'bob.near',
          receipt_id: 'receipt456',
          receiver_account_id: 'alice.near',
        },
      ];

      const mockResponse = {
        txns: mockReceipts,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountReceipts(mockAddress);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${mockAddress}/receipts?page=1&per_page=25`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.receipt_id).toBe('receipt123');
        expect(result.value[1]?.receipt_id).toBe('receipt456');
      }
    });

    it('should fetch receipts with custom pagination', async () => {
      const mockResponse = {
        txns: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountReceipts(mockAddress, 2, 25);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${mockAddress}/receipts?page=2&per_page=25`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.isOk()).toBe(true);
    });

    it('should handle empty receipts', async () => {
      const mockResponse = {
        txns: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountReceipts(mockAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const result = await client.getAccountReceipts(invalidAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid NEAR account ID');
      }
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('should return error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const result = await client.getAccountReceipts(mockAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });
  });

  describe('getAccountActivities', () => {
    const mockAddress = 'alice.near';

    it('should fetch activities successfully', async () => {
      const mockActivities = [
        {
          absolute_nonstaked_amount: '1000000000000000000000000',
          absolute_staked_amount: '0',
          affected_account_id: 'alice.near',
          block_height: '12345678',
          block_timestamp: '1640000000000000000',
          cause: 'TRANSFER',
          direction: 'INBOUND' as const,
          event_index: '0',
          involved_account_id: 'bob.near',
          receipt_id: 'receipt123',
          transaction_hash: 'tx123',
        },
        {
          absolute_nonstaked_amount: '500000000000000000000000',
          absolute_staked_amount: '0',
          affected_account_id: 'alice.near',
          block_height: '12345679',
          block_timestamp: '1640000001000000000',
          cause: 'CONTRACT_REWARD',
          delta_nonstaked_amount: '500000000000000000000000',
          direction: 'OUTBOUND' as const,
          event_index: '0',
          involved_account_id: 'validator.near',
          receipt_id: 'receipt456',
          transaction_hash: 'tx456',
        },
      ];

      const mockResponse = {
        activities: mockActivities,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountActivities(mockAddress);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${mockAddress}/activities?per_page=25`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.direction).toBe('INBOUND');
        expect(result.value[1]?.direction).toBe('OUTBOUND');
      }
    });

    it('should fetch activities with custom pagination', async () => {
      const mockResponse = {
        activities: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountActivities(mockAddress, 'cursor123', 20);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${mockAddress}/activities?cursor=cursor123&per_page=20`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.isOk()).toBe(true);
    });

    it('should handle empty activities', async () => {
      const mockResponse = {
        activities: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountActivities(mockAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const result = await client.getAccountActivities(invalidAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid NEAR account ID');
      }
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('should return error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const result = await client.getAccountActivities(mockAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });

    it('should handle activities with cursor', async () => {
      const mockResponse = {
        cursor: 'next-page-cursor',
        activities: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountActivities(mockAddress);

      expect(result.isOk()).toBe(true);
    });
  });

  describe('getAccountFtTransactions', () => {
    const mockAddress = 'alice.near';

    it('should fetch FT transactions successfully', async () => {
      const mockFtTxs = [
        {
          affected_account_id: 'alice.near',
          block_timestamp: '1640000000000000000',
          ft: {
            contract: 'usdc.near',
            decimals: 6,
            name: 'USD Coin',
            symbol: 'USDC',
          },
          receipt_id: 'receipt123',
        },
        {
          affected_account_id: 'alice.near',
          block_height: 100000,
          block_timestamp: '1640000001000000000',
          cause: 'TRANSFER',
          delta_amount: '1000000',
          ft: {
            contract: 'dai.near',
            decimals: 18,
            symbol: 'DAI',
          },
          involved_account_id: 'bob.near',
          receipt_id: 'receipt456',
          transaction_hash: 'tx456',
        },
      ];

      const mockResponse = {
        txns: mockFtTxs,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountFtTransactions(mockAddress);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${mockAddress}/ft-txns?page=1&per_page=25`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.ft?.symbol).toBe('USDC');
        expect(result.value[1]?.ft?.symbol).toBe('DAI');
      }
    });

    it('should fetch FT transactions with custom pagination', async () => {
      const mockResponse = {
        txns: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountFtTransactions(mockAddress, 4, 10);

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/v1/account/${mockAddress}/ft-txns?page=4&per_page=10`,
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.isOk()).toBe(true);
    });

    it('should handle empty FT transactions', async () => {
      const mockResponse = {
        txns: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountFtTransactions(mockAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const result = await client.getAccountFtTransactions(invalidAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid NEAR account ID');
      }
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('should return error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const result = await client.getAccountFtTransactions(mockAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });

    it('should handle FT transactions with cursor', async () => {
      const mockResponse = {
        cursor: 'next-page-cursor',
        txns: [],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountFtTransactions(mockAddress);

      expect(result.isOk()).toBe(true);
    });

    it('should handle FT transactions with minimal metadata', async () => {
      const mockResponse = {
        txns: [
          {
            affected_account_id: 'alice.near',
            block_timestamp: '1640000000000000000',
            ft: {
              contract: 'token.near',
              decimals: 18,
            },
            receipt_id: 'receipt123',
          },
        ],
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const result = await client.getAccountFtTransactions(mockAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]?.ft?.contract).toBe('token.near');
        expect(result.value[0]?.ft?.symbol).toBeUndefined();
      }
    });
  });
});
