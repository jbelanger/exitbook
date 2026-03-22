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
import { TatumBitcoinApiClient, tatumBitcoinMetadata } from '../tatum-bitcoin.api-client.js';
import type { TatumBitcoinBalance, TatumBitcoinTransaction } from '../tatum.schemas.js';

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

vi.stubEnv('TATUM_API_KEY', 'test-api-key');

// ── Fixtures ────────────────────────────────────────────────────────

const TEST_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

function buildBalance(overrides?: Partial<TatumBitcoinBalance>): TatumBitcoinBalance {
  return {
    incoming: '5000000000',
    outgoing: '1000000000',
    ...overrides,
  };
}

function buildTransaction(overrides?: Partial<TatumBitcoinTransaction>): TatumBitcoinTransaction {
  return {
    blockNumber: 800000,
    fee: '5000',
    hash: 'abc123txhash',
    index: 0,
    inputs: [
      {
        coin: {
          address: '1InputAddress',
          coinbase: false,
          height: 799999,
          script: 'script',
          value: 100000,
          version: 0,
        },
        prevout: {
          hash: 'prev-hash-123',
          index: 0,
        },
        script: 'input-script',
        sequence: 4294967295,
      },
    ],
    locktime: 0,
    outputs: [
      {
        address: '1OutputAddress',
        script: 'output-script',
        scriptPubKey: { type: 'pubkeyhash' },
        value: 95000,
      },
    ],
    hex: 'rawtxhex',
    size: 250,
    time: 1688212800,
    version: 2,
    vsize: 250,
    weight: 1000,
    witnessHash: 'witness-hash',
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('TatumBitcoinApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: TatumBitcoinApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('bitcoin', 'tatum');
    client = new TatumBitcoinApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(TatumBitcoinApiClient);
      expect(client.blockchain).toBe('bitcoin');
      expect(client.name).toBe('tatum');
    });

    it('should require API key', () => {
      expect(tatumBitcoinMetadata.requiresApiKey).toBe(true);
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
      expect(capabilities.supportedCursorTypes).toEqual(['pageToken', 'blockNumber', 'timestamp']);
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(3);
      expect(rateLimit.burstLimit).toBe(50);
      expect(rateLimit.requestsPerMinute).toBe(180);
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should calculate balance from incoming - outgoing', async () => {
      mockGet.mockResolvedValue(ok(buildBalance()));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'BTC',
        rawAmount: '4000000000', // 5000000000 - 1000000000
        decimalAmount: '40',
        decimals: 8,
      });
      expect(mockGet).toHaveBeenCalledWith(
        `/address/balance/${TEST_ADDRESS}`,
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(ok(buildBalance({ incoming: '0', outgoing: '0' })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('API Error')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('API Error');
    });
  });

  describe('execute - hasAddressTransactions', () => {
    it('should return true when transactions exist', async () => {
      mockGet.mockResolvedValue(ok([buildTransaction()]));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(true);
    });

    it('should return false when no transactions', async () => {
      mockGet.mockResolvedValue(ok([]));

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
          type: 'unsupportedOperation',
          address: TEST_ADDRESS,
        } as unknown as OneShotOperation)
      );

      expect(error.message).toBe('Unsupported operation: unsupportedOperation');
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

    it('should stream transactions with offset-based pagination', async () => {
      // Single page (< 50 results = complete)
      mockGet.mockResolvedValueOnce(ok([buildTransaction()]));

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe('abc123txhash');
      expect(transactions[0]!.providerName).toBe('tatum');
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
      expect(cursor).toEqual({ type: 'blockNumber', value: 99996 });
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
      const cursor = { type: 'pageToken' as const, value: '50', providerName: 'tatum' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target genesis address balance endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/address/balance/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    });

    it('should validate any non-null response', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ incoming: '0', outgoing: '0' })).toBe(true);
      expect(validate({})).toBe(true);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
    });
  });

  describe('isHealthy', () => {
    it('should return true when API responds', async () => {
      mockGet.mockResolvedValue(ok(buildBalance({ incoming: '0', outgoing: '0' })));

      const result = await client.isHealthy();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('should return error when API fails', async () => {
      mockGet.mockResolvedValue(err(new Error('API Error')));

      const result = await client.isHealthy();

      expect(result.isErr()).toBe(true);
    });
  });
});
