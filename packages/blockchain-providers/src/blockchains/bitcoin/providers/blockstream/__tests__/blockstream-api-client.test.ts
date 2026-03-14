/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
/* eslint-disable unicorn/no-null -- acceptable for tests */
import { err, ok } from '@exitbook/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OneShotOperation } from '../../../../../core/index.js';
import {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  type MockHttpClient,
  resetMockHttpClient,
} from '../../../../../core/utils/test-utils.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { BitcoinTransaction } from '../../../schemas.js';
import { BlockstreamApiClient, blockstreamMetadata } from '../blockstream.api-client.js';
import type { BlockstreamAddressInfo, BlockstreamTransaction } from '../blockstream.schemas.js';

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
    warn: vi.fn(),
  })),
}));

// ── Fixtures ────────────────────────────────────────────────────────

const TEST_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

const emptyStats = {
  funded_txo_count: 0,
  funded_txo_sum: 0,
  spent_txo_count: 0,
  spent_txo_sum: 0,
  tx_count: 0,
};

function buildAddressInfo(overrides?: Partial<BlockstreamAddressInfo>): BlockstreamAddressInfo {
  return {
    address: TEST_ADDRESS,
    chain_stats: {
      funded_txo_count: 5,
      funded_txo_sum: 10000000000,
      spent_txo_count: 3,
      spent_txo_sum: 6000000000,
      tx_count: 8,
    },
    mempool_stats: emptyStats,
    ...overrides,
  };
}

function buildTransaction(overrides?: Partial<BlockstreamTransaction>): BlockstreamTransaction {
  return {
    fee: 5000,
    locktime: 0,
    size: 250,
    status: {
      block_hash: '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72f9a4670',
      block_height: 800000,
      block_time: new Date('2023-07-01T12:00:00Z'),
      confirmed: true,
    },
    txid: 'abc123txid',
    version: 2,
    vin: [
      {
        is_coinbase: false,
        prevout: {
          scriptpubkey: '76a914...88ac',
          scriptpubkey_address: '1InputAddress',
          scriptpubkey_asm: 'OP_DUP ...',
          scriptpubkey_type: 'p2pkh',
          value: 100000,
        },
        scriptsig: 'sig',
        scriptsig_asm: 'asm',
        sequence: 4294967295,
        txid: 'prev-txid',
        vout: 0,
      },
    ],
    vout: [
      {
        scriptpubkey: '76a914...88ac',
        scriptpubkey_address: '1OutputAddress',
        scriptpubkey_asm: 'OP_DUP ...',
        scriptpubkey_type: 'p2pkh',
        value: 95000,
      },
    ],
    weight: 1000,
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('BlockstreamApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: BlockstreamApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('bitcoin', 'blockstream.info');
    client = new BlockstreamApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(BlockstreamApiClient);
      expect(client.blockchain).toBe('bitcoin');
      expect(client.name).toBe('blockstream.info');
    });

    it('should not require API key', () => {
      expect(blockstreamMetadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toEqual([
        'getAddressTransactions',
        'getAddressBalances',
        'hasAddressTransactions',
      ]);
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('txHash');
      expect(capabilities.replayWindow).toEqual({ blocks: 4 });
      expect(capabilities.supportedCursorTypes).toEqual(['txHash', 'blockNumber', 'timestamp']);
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should calculate balance from chain_stats funded - spent', async () => {
      mockGet.mockResolvedValue(
        ok(
          buildAddressInfo({
            chain_stats: {
              funded_txo_count: 5,
              funded_txo_sum: 10000000000,
              spent_txo_count: 3,
              spent_txo_sum: 6000000000,
              tx_count: 8,
            },
            mempool_stats: emptyStats,
          })
        )
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'BTC',
        rawAmount: '4000000000',
        decimalAmount: '40',
        decimals: 8,
      });
      expect(mockGet).toHaveBeenCalledWith(
        `/address/${TEST_ADDRESS}`,
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should include mempool balance in total', async () => {
      mockGet.mockResolvedValue(
        ok(
          buildAddressInfo({
            chain_stats: {
              funded_txo_count: 1,
              funded_txo_sum: 5000000000,
              spent_txo_count: 0,
              spent_txo_sum: 0,
              tx_count: 1,
            },
            mempool_stats: {
              funded_txo_count: 1,
              funded_txo_sum: 1000000000,
              spent_txo_count: 0,
              spent_txo_sum: 0,
              tx_count: 1,
            },
          })
        )
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('6000000000');
      expect(result.decimalAmount).toBe('60');
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(ok(buildAddressInfo({ chain_stats: emptyStats, mempool_stats: emptyStats })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Network timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network timeout');
    });
  });

  describe('execute - hasAddressTransactions', () => {
    it('should return true when tx_count > 0', async () => {
      mockGet.mockResolvedValue(ok(buildAddressInfo()));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(true);
    });

    it('should return false when tx_count is 0', async () => {
      mockGet.mockResolvedValue(ok(buildAddressInfo({ chain_stats: emptyStats, mempool_stats: emptyStats })));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(false);
    });

    it('should count mempool transactions', async () => {
      mockGet.mockResolvedValue(
        ok(
          buildAddressInfo({
            chain_stats: emptyStats,
            mempool_stats: {
              funded_txo_count: 1,
              funded_txo_sum: 1000,
              spent_txo_count: 0,
              spent_txo_sum: 0,
              tx_count: 1,
            },
          })
        )
      );

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(true);
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Rate limited')));

      const error = expectErr(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(error.message).toBe('Rate limited');
    });
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unknown operation type', async () => {
      const error = expectErr(
        await client.execute({
          type: 'getTokenMetadata',
          address: TEST_ADDRESS,
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
        streamType: 'internal' as never,
      })) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Unsupported transaction type');
    });

    it('should stream transactions with txid-based pagination', async () => {
      const tx = buildTransaction();

      // Single page (< 25 results = complete)
      mockGet.mockResolvedValueOnce(ok([tx]));

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe('abc123txid');
      expect(transactions[0]!.providerName).toBe('blockstream.info');
      expect(transactions[0]!.status).toBe('success');
    });

    it('should handle empty transaction list', async () => {
      mockGet.mockResolvedValueOnce(ok([]));

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
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
  });

  describe('extractCursors', () => {
    it('should always include txHash as primary cursor', () => {
      const cursors = client.extractCursors({
        id: 'tx-abc123',
        blockHeight: 800000,
        timestamp: 1700000000000,
      } as BitcoinTransaction);

      expect(cursors).toEqual([
        { type: 'txHash', value: 'tx-abc123' },
        { type: 'blockNumber', value: 800000 },
        { type: 'timestamp', value: 1700000000000 },
      ]);
    });

    it('should omit blockNumber when blockHeight is undefined', () => {
      const cursors = client.extractCursors({
        id: 'tx-abc123',
        timestamp: 1700000000000,
      } as BitcoinTransaction);

      expect(cursors).toEqual([
        { type: 'txHash', value: 'tx-abc123' },
        { type: 'timestamp', value: 1700000000000 },
      ]);
    });

    it('should omit timestamp when falsy', () => {
      const cursors = client.extractCursors({
        id: 'tx-abc123',
        blockHeight: 800000,
        timestamp: 0,
      } as BitcoinTransaction);

      expect(cursors).toEqual([
        { type: 'txHash', value: 'tx-abc123' },
        { type: 'blockNumber', value: 800000 },
      ]);
    });
  });

  describe('applyReplayWindow', () => {
    it('should subtract replay blocks from blockNumber cursor', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 100000 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 99996 });
    });

    it('should not go below zero', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 2 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 0 });
    });

    it('should pass through txHash cursors unchanged', () => {
      const cursor = { type: 'txHash' as const, value: 'abc123' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through timestamp cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1700000000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target /blocks/tip/height endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/blocks/tip/height');
    });

    it('should validate response as positive number', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate(800000)).toBe(true);
      expect(validate(1)).toBe(true);
      expect(validate(0)).toBe(false);
      expect(validate(-1)).toBe(false);
      expect(validate('800000')).toBe(false);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
    });
  });
});
