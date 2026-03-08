/* eslint-disable unicorn/no-null -- acceptable for tests */
import { err, ok } from '@exitbook/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  type MockHttpClient,
  resetMockHttpClient,
} from '../../../../../core/utils/test-utils.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { EvmTransaction } from '../../../types.js';
import { EtherscanApiClient, etherscanMetadata } from '../etherscan.api-client.js';

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

function buildNormalTxResponse(overrides = {}) {
  return {
    status: '1',
    message: 'OK',
    result: [
      {
        blockNumber: '12345',
        timeStamp: '1700000000',
        hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
        nonce: '0',
        blockHash: '0xabcdef0000000000000000000000000000000000000000000000000000000000',
        transactionIndex: '0',
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '1000000000000000000',
        gas: '21000',
        gasPrice: '1000000000',
        isError: '0',
        txreceipt_status: '1',
        input: '0x',
        contractAddress: '',
        cumulativeGasUsed: '21000',
        gasUsed: '21000',
        confirmations: '100',
        methodId: '',
        functionName: '',
        ...overrides,
      },
    ],
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('EtherscanApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: EtherscanApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('ethereum', 'etherscan');
    client = new EtherscanApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(EtherscanApiClient);
      expect(client.blockchain).toBe('ethereum');
      expect(client.name).toBe('etherscan');
    });

    it('should require API key', () => {
      expect(etherscanMetadata.requiresApiKey).toBe(true);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.preferredCursorType).toBe('pageToken');
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });

    it('should filter transaction types to match chain config (ethereum)', () => {
      const { capabilities } = client;
      // Ethereum supports all types including beacon_withdrawal
      expect(capabilities.supportedTransactionTypes).toContain('normal');
      expect(capabilities.supportedTransactionTypes).toContain('internal');
      expect(capabilities.supportedTransactionTypes).toContain('token');
      expect(capabilities.supportedTransactionTypes).toContain('beacon_withdrawal');
    });
  });

  describe('execute', () => {
    it('should always return error (streaming-only provider)', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toContain('streaming operations');
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
      expect(error.message).toContain('Streaming not supported');
    });

    it('should yield error for unsupported stream type', async () => {
      const results = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'unknown_type' as never,
      })) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Unsupported transaction type');
    });

    it('should stream normal transactions', async () => {
      // Etherscan uses no schema validation at HTTP level; parseResponse handles it
      mockGet.mockResolvedValue(ok(buildNormalTxResponse()));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toContain('0xdeadbeef');
      expect(transactions[0]!.providerName).toBe('etherscan');
      expect(transactions[0]!.currency).toBe('ETH');
    });

    it('should handle no transactions found (status 0)', async () => {
      mockGet.mockResolvedValue(ok({ status: '0', message: 'No transactions found', result: 'No transactions found' }));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
    });

    it('should propagate API errors during streaming', async () => {
      mockGet.mockResolvedValue(err(new Error('Rate limited')));

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

    it('should stream internal transactions', async () => {
      mockGet.mockResolvedValue(ok({ status: '0', message: 'No transactions found', result: 'No transactions found' }));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'internal',
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
    });

    it('should stream beacon_withdrawal transactions', async () => {
      mockGet.mockResolvedValue(ok({ status: '0', message: 'No transactions found', result: 'No transactions found' }));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'beacon_withdrawal',
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
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
  });

  describe('getHealthCheckConfig', () => {
    it('should target eth_block_number endpoint with chainId', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toContain('eth_block_number');
      expect(config.endpoint).toContain('chainid=1'); // ethereum chainId = 1
    });

    it('should validate response with status 1 and result string', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ status: '1', result: '0xf4240' })).toBe(true);
      expect(validate({ status: '0', result: '0xf4240' })).toBeFalsy();
      expect(validate({ status: '1' })).toBeFalsy();
      expect(validate(null)).toBeFalsy();
    });
  });
});
