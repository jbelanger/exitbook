/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
/* eslint-disable unicorn/no-null -- acceptable for tests */
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
import type { BitcoinTransaction } from '../../../schemas.js';
import { BlockchainComApiClient, blockchainComMetadata } from '../blockchain-com.api-client.js';
import type { BlockchainComAddressResponse } from '../blockchain-com.schemas.js';

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

function buildAddressResponse(overrides?: Partial<BlockchainComAddressResponse>): BlockchainComAddressResponse {
  return {
    address: TEST_ADDRESS,
    final_balance: 5000000000,
    hash160: 'abc123',
    n_tx: 10,
    total_received: 10000000000,
    total_sent: 5000000000,
    txs: [],
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('BlockchainComApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: BlockchainComApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('bitcoin', 'blockchain.com');
    client = new BlockchainComApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(BlockchainComApiClient);
      expect(client.blockchain).toBe('bitcoin');
      expect(client.name).toBe('blockchain.com');
    });

    it('should not require API key', () => {
      expect(blockchainComMetadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toEqual([
        'getAddressTransactions',
        'getAddressBalances',
        'hasAddressTransactions',
      ]);
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('pageToken');
      expect(capabilities.replayWindow).toEqual({ blocks: 4 });
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return balance data from final_balance', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ final_balance: 4000000000 })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'BTC',
        rawAmount: '4000000000',
        decimalAmount: '40',
        decimals: 8,
      });
      expect(mockGet).toHaveBeenCalledWith(
        `/rawaddr/${TEST_ADDRESS}?limit=0`,
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ final_balance: 0 })));

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
    it('should return true when n_tx > 0', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ n_tx: 5 })));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(true);
    });

    it('should return false when n_tx is 0', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ n_tx: 0 })));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(false);
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

    it('should stream transactions with offset-based pagination', async () => {
      const tx1 = {
        block_index: undefined,
        hash: 'tx-hash-1',
        time: 1700000000,
        fee: 500,
        ver: 2,
        lock_time: 0,
        size: 250,
        block_height: 12345,
        double_spend: false,
        relayed_by: '0.0.0.0',
        result: 1000,
        tx_index: 100,
        vin_sz: 1,
        vout_sz: 1,
        inputs: [
          {
            script: 'script',
            prev_out: {
              addr: 'input-addr',
              n: 0,
              script: 'script',
              spent: true,
              tx_index: 99,
              type: 0,
              value: 2000,
            },
          },
        ],
        out: [
          {
            addr: 'output-addr',
            n: 0,
            script: 'script',
            spent: false,
            tx_index: 100,
            type: 0,
            value: 1500,
          },
        ],
      };

      // Single page (< 50 results = complete)
      mockGet.mockResolvedValue(ok(buildAddressResponse({ txs: [tx1] })));

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe('tx-hash-1');
      expect(transactions[0]!.providerName).toBe('blockchain.com');
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
    it('should extract blockNumber and timestamp cursors', () => {
      const cursors = client.extractCursors({
        blockHeight: 800000,
        timestamp: 1700000000000,
      } as BitcoinTransaction);

      expect(cursors).toEqual([
        { type: 'blockNumber', value: 800000 },
        { type: 'timestamp', value: 1700000000000 },
      ]);
    });

    it('should omit blockNumber when blockHeight is undefined', () => {
      const cursors = client.extractCursors({
        timestamp: 1700000000000,
      } as BitcoinTransaction);

      expect(cursors).toEqual([{ type: 'timestamp', value: 1700000000000 }]);
    });

    it('should return empty array when no cursor data available', () => {
      const cursors = client.extractCursors({} as BitcoinTransaction);
      expect(cursors).toEqual([]);
    });
  });

  describe('applyReplayWindow', () => {
    it('should subtract replay blocks from blockNumber cursor', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 100000 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 99996 }); // 100000 - 4
    });

    it('should not go below zero', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 2 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 0 });
    });

    it('should pass through non-blockNumber cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1700000000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through pageToken cursors unchanged', () => {
      const cursor = { type: 'pageToken' as const, value: '50', providerName: 'blockchain.com' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target /latestblock endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/latestblock');
    });

    it('should validate response with positive height', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ height: 800000 })).toBe(true);
      expect(validate({ height: 0 })).toBe(false);
      expect(validate({ height: -1 })).toBe(false);
      expect(validate({})).toBe(false);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
    });
  });
});
