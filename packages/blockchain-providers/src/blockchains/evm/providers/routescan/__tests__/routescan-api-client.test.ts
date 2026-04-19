/* eslint-disable unicorn/no-null -- acceptable for tests */
import type { CursorState } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OneShotOperation } from '../../../../../contracts/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  type MockHttpClient,
  resetMockHttpClient,
} from '../../../../../test-support/provider-test-utils.js';
import type { EvmTransaction } from '../../../types.js';
import { RoutescanApiClient, routescanMetadata } from '../routescan.api-client.js';
import type {
  RoutescanInternalTransaction,
  RoutescanTransaction,
  RoutescanTokenTransfer,
} from '../routescan.schemas.js';

// ── Module-level mocks (hoisted by vitest) ──────────────────────────

const mockHttp = createMockHttpClient();

vi.mock('@exitbook/shared-utils', () => ({
  HttpClient: vi.fn(() => mockHttp),
  maskAddress: (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`,
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  })),
}));

// ── Fixtures ────────────────────────────────────────────────────────

const TEST_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const TEST_TIMESTAMP = new Date(1700000000 * 1000);

function buildNormalTx(overrides?: Partial<RoutescanTransaction>): RoutescanTransaction {
  return {
    blockHash: '0xabcdef',
    blockNumber: '12345',
    confirmations: '100',
    contractAddress: null,
    cumulativeGasUsed: '21000',
    from: '0x1111111111111111111111111111111111111111',
    functionName: null,
    gas: '21000',
    gasPrice: '1000000000',
    gasUsed: '21000',
    hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
    input: '0x',
    isError: '0',
    methodId: null,
    nonce: '1',
    timeStamp: TEST_TIMESTAMP,
    to: '0x2222222222222222222222222222222222222222',
    transactionIndex: '1',
    txreceipt_status: '1',
    value: '1000000000000000000',
    ...overrides,
  };
}

function buildInternalTx(overrides?: Partial<RoutescanInternalTransaction>): RoutescanInternalTransaction {
  return {
    blockNumber: '12345',
    contractAddress: '0x0000000000000000000000000000000000000000',
    errCode: '',
    from: '0x1111111111111111111111111111111111111111',
    gas: '21000',
    gasUsed: '21000',
    hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000002',
    input: '0x',
    isError: '0',
    timeStamp: TEST_TIMESTAMP,
    to: '0x2222222222222222222222222222222222222222',
    traceId: '0',
    type: 'call',
    value: '500000000000000000',
    ...overrides,
  };
}

function buildTokenTransfer(overrides?: Partial<RoutescanTokenTransfer>): RoutescanTokenTransfer {
  return {
    blockHash: '0xabcdef',
    blockNumber: '12345',
    confirmations: '100',
    contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    cumulativeGasUsed: '21000',
    from: '0x1111111111111111111111111111111111111111',
    gas: '21000',
    gasPrice: '1000000000',
    gasUsed: '21000',
    hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000003',
    input: '0x',
    nonce: '1',
    timeStamp: TEST_TIMESTAMP,
    to: '0x2222222222222222222222222222222222222222',
    tokenDecimal: '6',
    tokenName: 'USD Coin',
    tokenSymbol: 'USDC',
    transactionIndex: '1',
    value: '1000000',
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('RoutescanApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: RoutescanApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('ethereum', 'routescan');
    client = new RoutescanApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(RoutescanApiClient);
      expect(client.blockchain).toBe('ethereum');
      expect(client.name).toBe('routescan');
    });

    it('should not require API key', () => {
      expect(routescanMetadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal', 'internal', 'token']);
      expect(capabilities.preferredCursorType).toBe('pageToken');
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return balance data for valid address', async () => {
      mockGet.mockResolvedValue(ok({ message: 'OK', result: '2000000000000000000', status: '1' }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toMatchObject({
        symbol: 'ETH',
        rawAmount: '2000000000000000000',
        decimals: 18,
      });
      expect(result.decimalAmount).toBe('2');
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(ok({ message: 'OK', result: '0', status: '1' }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
    });

    it('should return error when status is not 1', async () => {
      mockGet.mockResolvedValue(ok({ message: 'Error! Invalid address format', result: '', status: '0' }));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toContain('Error! Invalid address format');
    });

    it('should reject invalid EVM address', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'not-an-address' }));
      expect(error.message).toContain('Invalid EVM address');
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Network timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network timeout');
    });
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unsupported operation type', async () => {
      const error = expectErr(
        await client.execute({
          type: 'getTokenMetadata',
          contractAddresses: [],
        } as unknown as OneShotOperation)
      );

      expect(error.message).toContain('Unsupported operation');
    });
  });

  describe('executeStreaming', () => {
    it('should yield error for non-getAddressTransactions operation', async () => {
      const results = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressBalances',
        address: TEST_ADDRESS,
      } as never)) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Streaming not yet implemented');
    });

    it('should yield error for unsupported stream type', async () => {
      const results = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'beacon_withdrawal' as never,
      })) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Unsupported transaction type');
    });

    it('should stream normal transactions', async () => {
      const tx = buildNormalTx();
      mockGet.mockResolvedValue(ok({ message: 'OK', result: [tx], status: '1' }));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe(tx.hash);
      expect(transactions[0]!.providerName).toBe('routescan');
      expect(transactions[0]!.currency).toBe('ETH');
    });

    it('should handle no transactions found', async () => {
      mockGet.mockResolvedValue(ok({ message: 'No transactions found', result: [], status: '0' }));

      const batches = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        batches.push(result);
      }

      // Routescan treats "No transactions found" as a valid empty completion
      expect(batches.length).toBeGreaterThanOrEqual(1);
      const firstBatch = expectOk(batches[0]!);
      expect(firstBatch.data).toHaveLength(0);
    });

    it('should stream internal transactions', async () => {
      const tx = buildInternalTx();
      mockGet.mockResolvedValue(ok({ message: 'OK', result: [tx], status: '1' }));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'internal',
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.type).toBe('internal');
    });

    it('should stream token transactions', async () => {
      const tx = buildTokenTransfer();
      mockGet.mockResolvedValue(ok({ message: 'OK', result: [tx], status: '1' }));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'token',
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.type).toBe('token_transfer');
      expect(transactions[0]!.tokenSymbol).toBe('USDC');
    });

    it('should propagate API errors during streaming', async () => {
      mockGet.mockResolvedValue(err(new Error('Server error')));

      let gotError = false;
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        expectErr(result);
        gotError = true;
      }

      expect(gotError).toBe(true);
    });

    it('should ignore legacy numeric page tokens and resume from the supported block cursor format', async () => {
      const tx = buildNormalTx();
      mockGet.mockResolvedValue(ok({ message: 'OK', result: [tx], status: '1' }));

      const resumeCursor: CursorState = {
        primary: { type: 'pageToken', value: '12345', providerName: 'routescan' },
        lastTransactionId: tx.hash,
        metadata: { providerName: 'routescan', updatedAt: Date.now() },
        totalFetched: 1,
      };

      const batches = [];
      for await (const result of client.executeStreaming<EvmTransaction>(
        {
          type: 'getAddressTransactions',
          address: TEST_ADDRESS,
        },
        resumeCursor
      )) {
        batches.push(result);
      }

      expect(batches).toHaveLength(1);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet.mock.calls[0]?.[0]).toContain('startblock=0');
      expect(mockGet.mock.calls[0]?.[0]).not.toContain('startblock=12345');
    });
  });

  describe('extractCursors', () => {
    it('should extract blockNumber and timestamp cursors', () => {
      const cursors = client.extractCursors({
        blockHeight: 12345,
        timestamp: 1700000000000,
      } as EvmTransaction);

      expect(cursors).toEqual([
        { type: 'blockNumber', value: 12345 },
        { type: 'timestamp', value: 1700000000000 },
      ]);
    });

    it('should omit blockNumber when blockHeight is undefined', () => {
      const cursors = client.extractCursors({ timestamp: 1700000000000 } as EvmTransaction);
      expect(cursors).toEqual([{ type: 'timestamp', value: 1700000000000 }]);
    });

    it('should return empty array when no cursor data available', () => {
      expect(client.extractCursors({} as EvmTransaction)).toEqual([]);
    });
  });

  describe('applyReplayWindow', () => {
    it('should subtract replay blocks from blockNumber cursor', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 100000 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 99998 }); // 100000 - 2
    });

    it('should not go below zero', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 1 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 0 });
    });

    it('should pass through non-blockNumber cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1700000000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through pageToken cursors unchanged', () => {
      const cursor = { type: 'pageToken' as const, value: 'block:12345', providerName: 'routescan' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target stats module endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toContain('module=stats');
      expect(config.endpoint).toContain('action=ethsupply');
    });

    it('should validate response with status 1', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ status: '1', message: 'OK', result: '100' })).toBe(true);
      expect(validate({ status: '0', message: 'Error', result: '' })).toBe(false);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
      expect(validate({})).toBe(false);
    });
  });
});
