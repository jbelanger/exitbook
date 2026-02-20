/* eslint-disable unicorn/no-null -- acceptable for tests */
import { createHash } from 'node:crypto';

import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RawBalanceData, StreamingOperation } from '../../../../../core/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { NearBalanceChange, NearReceipt, NearTokenTransfer, NearTransaction } from '../../../schemas.js';
import { sortKeys } from '../mapper-utils.js';
import { NearBlocksApiClient } from '../nearblocks.api-client.js';
import type {
  NearBlocksActivity,
  NearBlocksFtTransaction,
  NearBlocksReceipt,
  NearBlocksTransaction,
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

/**
 * Helper to generate deterministic hash matching API client implementation
 */
function generateDeterministicHash(data: unknown): string {
  const rawJson = JSON.stringify(sortKeys(data));
  return createHash('sha256').update(rawJson).digest('hex');
}

describe('NearBlocksApiClient', () => {
  const providerRegistry = createProviderRegistry();
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

    const config = providerRegistry.createDefaultConfig('near', 'nearblocks');
    // Disable rate limiting for tests
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
      const config = providerRegistry.createDefaultConfig('near', 'nearblocks');
      const newClient = new NearBlocksApiClient(config);
      expect(newClient).toBeDefined();
    });

    it('should configure bearer token if API key provided', () => {
      const originalApiKey = process.env['NEARBLOCKS_API_KEY'];
      process.env['NEARBLOCKS_API_KEY'] = 'test-api-key';
      try {
        const config = providerRegistry.createDefaultConfig('near', 'nearblocks');
        const newClient = new NearBlocksApiClient(config);
        expect(newClient).toBeDefined();
      } finally {
        process.env['NEARBLOCKS_API_KEY'] = originalApiKey;
      }
    });
  });

  describe('capabilities', () => {
    it('should support four discrete transaction types', () => {
      const capabilities = client.capabilities;
      expect(capabilities.supportedTransactionTypes).toEqual([
        'transactions',
        'receipts',
        'balance-changes',
        'token-transfers',
      ]);
    });

    it('should support getAddressTransactions and getAddressBalances operations', () => {
      const capabilities = client.capabilities;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
    });

    it('should support pageToken cursor type', () => {
      const capabilities = client.capabilities;
      expect(capabilities.supportedCursorTypes).toContain('pageToken');
      expect(capabilities.preferredCursorType).toBe('pageToken');
    });

    it('should have replay window configuration', () => {
      const capabilities = client.capabilities;
      expect(capabilities.replayWindow).toBeDefined();
      expect(capabilities.replayWindow?.blocks).toBe(3);
    });
  });

  describe('streamTransactions', () => {
    const mockAddress = 'alice.near';

    const mockTransaction: NearBlocksTransaction = {
      transaction_hash: 'tx123',
      signer_account_id: 'alice.near',
      receiver_account_id: 'bob.near',
      block_timestamp: '1640000000000000000',
      block: { block_height: 100000 },
      included_in_block_hash: 'blockhash123',
      outcomes: { status: true },
      actions: null,
      actions_agg: null,
      id: null,
      outcomes_agg: null,
      receipt_block: null,
      receipt_conversion_tokens_burnt: null,
      receipt_id: null,
      receipt_kind: null,
      receipt_outcome: null,
    };

    it('should stream transactions successfully', async () => {
      const mockResponse = {
        txns: [mockTransaction],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'transactions' as const,
      };

      const allEvents: NearTransaction[] = [];
      for await (const result of client.executeStreaming<NearTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0]).toMatchObject({
        streamType: 'transactions',
        transactionHash: 'tx123',
        signerAccountId: 'alice.near',
        receiverAccountId: 'bob.near',
        timestamp: 1640000000000,
        blockHeight: 100000,
        status: true,
      });

      // Event ID should be transaction hash
      expect(allEvents[0]?.eventId).toBe('tx123');
      expect(allEvents[0]?.id).toBe('tx123');
    });

    it('should handle cursor pagination for transactions', async () => {
      const page1 = {
        txns: [mockTransaction],
        cursor: 'cursor123',
      };

      const page2 = {
        txns: [{ ...mockTransaction, transaction_hash: 'tx456' }],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValueOnce(ok(page1)).mockResolvedValueOnce(ok(page2));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'transactions' as const,
      };

      const allEvents: NearTransaction[] = [];
      for await (const result of client.executeStreaming<NearTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      expect(allEvents).toHaveLength(2);
      expect(mockHttpGet).toHaveBeenCalledTimes(2);
      expect(mockHttpGet).toHaveBeenNthCalledWith(
        1,
        `/v1/account/${mockAddress}/txns-only?per_page=25&order=asc`,
        expect.anything()
      );
      expect(mockHttpGet).toHaveBeenNthCalledWith(
        2,
        `/v1/account/${mockAddress}/txns-only?cursor=cursor123&per_page=25&order=asc`,
        expect.anything()
      );
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const operation = {
        type: 'getAddressTransactions' as const,
        address: invalidAddress,
        streamType: 'transactions' as const,
      };

      let hasError = false;
      for await (const result of client.executeStreaming<NearTransaction>(operation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid NEAR account ID');
          hasError = true;
        }
      }
      expect(hasError).toBe(true);
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      mockHttpGet.mockResolvedValue(err(new Error('API Error')));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'transactions' as const,
      };

      let hasError = false;
      for await (const result of client.executeStreaming<NearTransaction>(operation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toBe('API Error');
          hasError = true;
        }
      }
      expect(hasError).toBe(true);
    });
  });

  describe('streamReceipts', () => {
    const mockAddress = 'alice.near';

    const mockReceipt: NearBlocksReceipt = {
      receipt_id: 'receipt123',
      transaction_hash: 'tx123',
      predecessor_account_id: 'alice.near',
      receiver_account_id: 'bob.near',
      receipt_kind: 'ACTION',
      receipt_block: {
        block_hash: 'blockhash123',
        block_height: 100000,
        block_timestamp: 1640000000000,
      },
      receipt_outcome: {
        executor_account_id: 'bob.near',
        gas_burnt: '1000000',
        tokens_burnt: '50000000000000000000',
        status: true,
        logs: ['log1', 'log2'],
      },
      actions: [
        {
          action: 'TRANSFER',
          deposit: '1000000000000000000000000',
          method: undefined,
          args: undefined,
        },
      ],
    };

    it('should stream receipts successfully', async () => {
      const mockResponse = {
        txns: [mockReceipt],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'receipts' as const,
      };

      const allEvents: NearReceipt[] = [];
      for await (const result of client.executeStreaming<NearReceipt>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0]).toMatchObject({
        streamType: 'receipts',
        receiptId: 'receipt123',
        transactionHash: 'tx123',
        predecessorAccountId: 'alice.near',
        receiverAccountId: 'bob.near',
        receiptKind: 'ACTION',
        executorAccountId: 'bob.near',
        gasBurnt: '1000000',
        tokensBurntYocto: '50000000000000000000',
        status: true,
      });

      // Event ID should be receipt ID
      expect(allEvents[0]?.eventId).toBe('receipt123');
      expect(allEvents[0]?.id).toBe('tx123');
      expect(allEvents[0]?.logs).toEqual(['log1', 'log2']);
      expect(allEvents[0]?.actions).toHaveLength(1);
    });

    it('should handle cursor pagination for receipts', async () => {
      const page1 = {
        txns: [mockReceipt],
        cursor: 'cursor456',
      };

      const page2 = {
        txns: [{ ...mockReceipt, receipt_id: 'receipt456' }],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValueOnce(ok(page1)).mockResolvedValueOnce(ok(page2));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'receipts' as const,
      };

      const allEvents: NearReceipt[] = [];
      for await (const result of client.executeStreaming<NearReceipt>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      expect(allEvents).toHaveLength(2);
      expect(mockHttpGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('streamBalanceChanges - Fail-Fast Validation', () => {
    const mockAddress = 'alice.near';

    const mockActivity: NearBlocksActivity = {
      transaction_hash: 'tx123',
      receipt_id: 'receipt123',
      affected_account_id: 'alice.near',
      direction: 'INBOUND',
      delta_nonstaked_amount: '1000000000000000000000000',
      absolute_nonstaked_amount: '2000000000000000000000000',
      absolute_staked_amount: '0',
      block_timestamp: '1640000000000000000',
      block_height: '100000',
      cause: 'TRANSFER',
      involved_account_id: 'bob.near',
      event_index: '0',
    };

    it('should stream balance changes successfully', async () => {
      const mockResponse = {
        activities: [mockActivity],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'balance-changes' as const,
      };

      const allEvents: NearBalanceChange[] = [];
      for await (const result of client.executeStreaming<NearBalanceChange>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0]).toMatchObject({
        streamType: 'balance-changes',
        receiptId: 'receipt123',
        affectedAccountId: 'alice.near',
        direction: 'INBOUND',
        deltaAmountYocto: '1000000000000000000000000',
        absoluteNonstakedAmount: '2000000000000000000000000',
        cause: 'TRANSFER',
      });
    });

    it('should generate deterministic event ID for balance changes', async () => {
      const mockResponse = {
        activities: [mockActivity],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'balance-changes' as const,
      };

      const allEvents: NearBalanceChange[] = [];
      for await (const result of client.executeStreaming<NearBalanceChange>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      const event = allEvents[0];
      expect(event?.eventId).toBeDefined();
      expect(event?.eventId).toMatch(/^balance-changes:[a-f0-9]{64}$/);

      // Verify event ID is deterministic (SHA-256 of sorted raw data)
      const expectedHash = generateDeterministicHash(mockActivity);
      expect(event?.eventId).toBe(`balance-changes:${expectedHash}`);
    });

    it('should FAIL if balance change missing BOTH transaction_hash AND receipt_id', async () => {
      const orphanedActivity = {
        ...mockActivity,
        transaction_hash: undefined,
        receipt_id: undefined,
      };

      const mockResponse = {
        activities: [orphanedActivity],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'balance-changes' as const,
      };

      let hasError = false;
      for await (const result of client.executeStreaming<NearBalanceChange>(operation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Activity missing both transaction_hash and receipt_id');
          hasError = true;
        }
      }
      expect(hasError).toBe(true);
    });

    it('should continue if balance change missing receipt_id (will be attached to synthetic receipt in processor)', async () => {
      const uncorrelatableActivity = {
        ...mockActivity,
        receipt_id: undefined,
      };

      const mockResponse = {
        activities: [uncorrelatableActivity],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'balance-changes' as const,
      };

      // Activity without receipt_id should still be emitted (will be handled in processor)
      const events: NearBalanceChange[] = [];
      for await (const result of client.executeStreaming<NearBalanceChange>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          events.push(...result.value.data.map((item) => item.normalized));
        }
      }
      expect(events).toHaveLength(1);
      expect(events[0]?.receiptId).toBeUndefined();
    });

    it('should handle balance changes without deltaAmountYocto', async () => {
      const activityWithoutDelta = {
        ...mockActivity,
        delta_nonstaked_amount: undefined,
      };

      const mockResponse = {
        activities: [activityWithoutDelta],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'balance-changes' as const,
      };

      const allEvents: NearBalanceChange[] = [];
      for await (const result of client.executeStreaming<NearBalanceChange>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0]?.deltaAmountYocto).toBeUndefined();
      // Processor will derive delta from absolute amounts
    });
  });

  describe('streamTokenTransfers - Fail-Fast Validation', () => {
    const mockAddress = 'alice.near';

    const mockFtTransfer: NearBlocksFtTransaction = {
      transaction_hash: 'tx123',
      affected_account_id: 'alice.near',
      ft: {
        contract: 'usdc.near',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
      },
      delta_amount: '1000000',
      block_timestamp: '1640000000000000000',
      cause: 'TRANSFER',
      event_index: '12345',
      involved_account_id: 'bob.near',
    };

    it('should stream token transfers successfully', async () => {
      const mockResponse = {
        txns: [mockFtTransfer],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'token-transfers' as const,
      };

      const allEvents: NearTokenTransfer[] = [];
      for await (const result of client.executeStreaming<NearTokenTransfer>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0]).toMatchObject({
        streamType: 'token-transfers',
        transactionHash: 'tx123',
        affectedAccountId: 'alice.near',
        contractAddress: 'usdc.near',
        deltaAmountYocto: '1000000',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
        cause: 'TRANSFER',
      });
    });

    it('should namespace event_index with transaction hash for token transfer IDs', async () => {
      const mockResponse = {
        txns: [mockFtTransfer],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: mockAddress,
        streamType: 'token-transfers' as const,
      };

      const allEvents: NearTokenTransfer[] = [];
      for await (const result of client.executeStreaming<NearTokenTransfer>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          allEvents.push(...result.value.data.map((item) => item.normalized));
        }
      }

      const event = allEvents[0];
      expect(event?.eventId).toBe('token-transfers:tx123:12345');
    });
  });

  describe('extractCursors', () => {
    it('should extract cursors from transaction event', () => {
      const event: NearTransaction = {
        eventId: 'tx123',
        id: 'tx123',
        streamType: 'transactions',
        transactionHash: 'tx123',
        signerAccountId: 'alice.near',
        receiverAccountId: 'bob.near',
        timestamp: 1640000000000,
        blockHeight: 100000,
      };

      const cursors = client.extractCursors(event);

      expect(cursors).toHaveLength(2);
      expect(cursors).toContainEqual({ type: 'timestamp', value: 1640000000000 });
      expect(cursors).toContainEqual({ type: 'blockNumber', value: 100000 });
    });

    it('should extract cursors from receipt event', () => {
      const event: NearReceipt = {
        eventId: 'receipt123',
        id: 'tx123',
        streamType: 'receipts',
        receiptId: 'receipt123',
        transactionHash: 'tx123',
        predecessorAccountId: 'alice.near',
        receiverAccountId: 'bob.near',
        timestamp: 1640000000000,
        blockHeight: 100000,
      };

      const cursors = client.extractCursors(event);

      expect(cursors).toHaveLength(2);
      expect(cursors).toContainEqual({ type: 'timestamp', value: 1640000000000 });
      expect(cursors).toContainEqual({ type: 'blockNumber', value: 100000 });
    });

    it('should extract cursors from balance change event', () => {
      const event: NearBalanceChange = {
        eventId: 'balance-changes:hash123',
        id: 'tx123',
        streamType: 'balance-changes',
        transactionHash: 'tx123',
        receiptId: 'receipt123',
        affectedAccountId: 'alice.near',
        direction: 'INBOUND',
        absoluteNonstakedAmount: '1000000000000000000000000',
        absoluteStakedAmount: '0',
        timestamp: 1640000000000,
        blockHeight: '100000',
        cause: 'TRANSFER',
      };

      const cursors = client.extractCursors(event);

      expect(cursors).toHaveLength(2);
      expect(cursors).toContainEqual({ type: 'timestamp', value: 1640000000000 });
      expect(cursors).toContainEqual({ type: 'blockNumber', value: 100000 });
    });

    it('should extract cursors from token transfer event', () => {
      const event: NearTokenTransfer = {
        eventId: 'token-transfers:tx123:0',
        id: 'tx123',
        streamType: 'token-transfers',
        transactionHash: 'tx123',
        affectedAccountId: 'alice.near',
        contractAddress: 'usdc.near',
        decimals: 6,
        timestamp: 1640000000000,
        blockHeight: 100000,
      };

      const cursors = client.extractCursors(event);

      expect(cursors).toHaveLength(2);
      expect(cursors).toContainEqual({ type: 'timestamp', value: 1640000000000 });
      expect(cursors).toContainEqual({ type: 'blockNumber', value: 100000 });
    });
  });

  describe('applyReplayWindow', () => {
    it('should apply replay window to block number cursor', () => {
      const cursor = { type: 'blockNumber' as const, value: 100000 };
      const replayCursor = client.applyReplayWindow(cursor);

      expect(replayCursor).toEqual({ type: 'blockNumber', value: 99997 }); // 100000 - 3
    });

    it('should not apply replay window to timestamp cursor', () => {
      const cursor = { type: 'timestamp' as const, value: 1640000000000 };
      const replayCursor = client.applyReplayWindow(cursor);

      expect(replayCursor).toEqual(cursor);
    });

    it('should not go below zero when applying replay window', () => {
      const cursor = { type: 'blockNumber' as const, value: 2 };
      const replayCursor = client.applyReplayWindow(cursor);

      expect(replayCursor).toEqual({ type: 'blockNumber', value: 0 });
    });
  });

  describe('getAddressBalances', () => {
    const mockAddress = 'alice.near';

    it('should fetch balance successfully', async () => {
      const mockBalance = {
        account: [
          {
            account_id: 'alice.near',
            amount: '1000000000000000000000000',
            locked: null,
            block_height: null,
            block_hash: null,
            code_hash: null,
            storage_paid_at: null,
            storage_usage: null,
            created: null,
            deleted: null,
          },
        ],
      };

      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const operation = {
        type: 'getAddressBalances' as const,
        address: mockAddress,
      };

      const result = await client.execute(operation);

      expect(mockHttpGet).toHaveBeenCalledWith(`/v1/account/${mockAddress}`, expect.anything());
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

    it('should handle locked balance', async () => {
      const mockBalance = {
        account: [
          {
            account_id: 'alice.near',
            amount: '1000000000000000000000000',
            locked: '250000000000000000000000',
          },
        ],
      };

      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const operation = {
        type: 'getAddressBalances' as const,
        address: mockAddress,
      };

      const result = await client.execute(operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const value = result.value as RawBalanceData;
        // Should return available balance (amount - locked)
        expect(value.rawAmount).toBe('750000000000000000000000');
        expect(value.decimalAmount).toBe('0.75');
      }
    });

    it('should return error for invalid NEAR account ID', async () => {
      const invalidAddress = 'INVALID@ADDRESS';

      const operation = {
        type: 'getAddressBalances' as const,
        address: invalidAddress,
      };

      const result = await client.execute(operation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid NEAR account ID');
      }
      expect(mockHttpGet).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should return error for unsupported operation', async () => {
      const result = await client.execute({
        type: 'unsupportedOperation' as const,
      } as never);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Unsupported operation: unsupportedOperation');
      }
    });
  });

  describe('executeStreaming', () => {
    it('should return error for non-streaming operation', async () => {
      let hasError = false;
      for await (const result of client.executeStreaming({
        type: 'getAddressBalances',
        address: 'alice.near',
      } as unknown as StreamingOperation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Streaming not supported for operation');
          hasError = true;
        }
      }
      expect(hasError).toBe(true);
    });

    it('should return error for unsupported transaction type', async () => {
      let hasError = false;
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: 'alice.near',
        streamType: 'unsupported' as never,
      })) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Unsupported transaction type');
          hasError = true;
        }
      }
      expect(hasError).toBe(true);
    });

    it('should default to transactions type if not specified', async () => {
      const mockTransaction: NearBlocksTransaction = {
        transaction_hash: 'tx123',
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        block_timestamp: '1640000000000000000',
        block: { block_height: 100000 },
        included_in_block_hash: 'blockhash123',
        outcomes: { status: true },
        actions: null,
        actions_agg: null,
        id: null,
        outcomes_agg: null,
        receipt_block: null,
        receipt_conversion_tokens_burnt: null,
        receipt_id: null,
        receipt_kind: null,
        receipt_outcome: null,
      };

      const mockResponse = {
        txns: [mockTransaction],
        cursor: undefined,
      };

      mockHttpGet.mockResolvedValue(ok(mockResponse));

      const operation = {
        type: 'getAddressTransactions' as const,
        address: 'alice.near',
      };

      let called = false;
      for await (const result of client.executeStreaming(operation)) {
        expect(result.isOk()).toBe(true);
        called = true;
      }

      expect(called).toBe(true);
      expect(mockHttpGet).toHaveBeenCalledWith(expect.stringContaining('/txns-only'), expect.anything());
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
      expect(config.validate(null)).toBe(false);
    });
  });

  describe('event ID collision resistance', () => {
    it('should generate different IDs for different balance changes', () => {
      const activity1: NearBlocksActivity = {
        transaction_hash: 'tx123',
        receipt_id: 'receipt123',
        affected_account_id: 'alice.near',
        direction: 'INBOUND',
        absolute_nonstaked_amount: '1000000000000000000000000',
        absolute_staked_amount: '0',
        block_timestamp: '1640000000000000000',
        block_height: '100000',
        cause: 'TRANSFER',
        event_index: '0',
      };

      const activity2: NearBlocksActivity = {
        ...activity1,
        block_height: '100001', // Different block height
      };

      const hash1 = generateDeterministicHash(activity1);
      const hash2 = generateDeterministicHash(activity2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate same ID for identical balance changes', () => {
      const activity: NearBlocksActivity = {
        transaction_hash: 'tx123',
        receipt_id: 'receipt123',
        affected_account_id: 'alice.near',
        direction: 'INBOUND',
        absolute_nonstaked_amount: '1000000000000000000000000',
        absolute_staked_amount: '0',
        block_timestamp: '1640000000000000000',
        block_height: '100000',
        cause: 'TRANSFER',
        event_index: '0',
      };

      const hash1 = generateDeterministicHash(activity);
      const hash2 = generateDeterministicHash(activity);

      expect(hash1).toBe(hash2);
    });

    it('should generate different IDs regardless of key order', () => {
      // Test that key sorting works correctly
      const unsortedActivity = {
        block_height: '100000',
        affected_account_id: 'alice.near',
        transaction_hash: 'tx123',
        receipt_id: 'receipt123',
        direction: 'INBOUND',
        absolute_nonstaked_amount: '1000000000000000000000000',
        absolute_staked_amount: '0',
        block_timestamp: '1640000000000000000',
        cause: 'TRANSFER',
        event_index: '0',
      };

      const sortedActivity = {
        transaction_hash: 'tx123',
        receipt_id: 'receipt123',
        affected_account_id: 'alice.near',
        direction: 'INBOUND',
        absolute_nonstaked_amount: '1000000000000000000000000',
        absolute_staked_amount: '0',
        block_timestamp: '1640000000000000000',
        block_height: '100000',
        cause: 'TRANSFER',
        event_index: '0',
      };

      const hash1 = generateDeterministicHash(unsortedActivity);
      const hash2 = generateDeterministicHash(sortedActivity);

      // Should be identical after recursive key sorting
      expect(hash1).toBe(hash2);
    });
  });
});
