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
import { ThetaExplorerApiClient, thetaExplorerMetadata } from '../theta-explorer.api-client.js';

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

/**
 * Builds a raw Theta Explorer type-2 (send) transaction.
 * Provided as pre-validation input to the withValidation HOF inside the mapper.
 * The `timestamp` is a Unix epoch number (transformed to Date during validation).
 */
function buildThetaTransaction(overrides = {}) {
  return {
    block_height: '12345',
    hash: '0xabcdef0000000000000000000000000000000000000000000000000000000001',
    timestamp: 1700000000,
    type: 2,
    data: {
      source: null,
      target: null,
      inputs: [
        {
          address: '0x1111111111111111111111111111111111111111',
          coins: { thetawei: '0', tfuelwei: '1000000000000000000' },
        },
      ],
      outputs: [
        {
          address: '0x2222222222222222222222222222222222222222',
          coins: { thetawei: '0', tfuelwei: '1000000000000000000' },
        },
      ],
    },
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('ThetaExplorerApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: ThetaExplorerApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('theta', 'theta-explorer');
    client = new ThetaExplorerApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(ThetaExplorerApiClient);
      expect(client.blockchain).toBe('theta');
      expect(client.name).toBe('theta-explorer');
    });

    it('should not require API key', () => {
      expect(thetaExplorerMetadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('pageToken');
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });
  });

  describe('execute', () => {
    it('should return error for any operation (no one-shot operations supported)', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

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
        streamType: 'token' as never,
      })) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Unsupported transaction type');
    });

    it('should handle 404 as empty result (no transactions)', async () => {
      mockGet.mockResolvedValue(err(new Error('HTTP 404 Not Found')));

      const transactions: EvmTransaction[] = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      // 404 is treated as "no transactions", not an error
      expect(transactions).toHaveLength(0);
    });

    it('should propagate non-404 API errors during streaming', async () => {
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

    it('should stream normal transactions (type 2 send)', async () => {
      const tx = buildThetaTransaction();
      mockGet.mockResolvedValue(
        ok({
          body: [tx],
          currentPageNumber: 1,
          totalPageNumber: 1,
          type: 'account_tx_list',
        })
      );

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
      expect(transactions[0]!.providerName).toBe('theta-explorer');
      expect(transactions[0]!.currency).toBe('TFUEL');
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

    it('should pass through timestamp cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1700000000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target theta supply endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/supply/theta');
    });

    it('should validate response with total_supply number', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ total_supply: 1000000000 })).toBe(true);
      expect(validate({ total_supply: 0 })).toBe(true);
      expect(validate({ total_supply: 'string' })).toBeFalsy();
      expect(validate({})).toBeFalsy();
      expect(validate(null)).toBeFalsy();
    });
  });
});
