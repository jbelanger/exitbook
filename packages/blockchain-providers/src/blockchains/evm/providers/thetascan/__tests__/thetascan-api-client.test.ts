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
import type { EvmTransaction } from '../../../types.js';
import { ThetaScanApiClient, thetaScanMetadata } from '../thetascan.api-client.js';

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
const CONTRACT_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

/**
 * Builds a raw ThetaScan transaction.
 * Provided as pre-validation input; `timestamp` is Unix epoch (converted to Date by withValidation).
 * `tfuel` and `theta` use the ThetaScan comma-formatted numeric string format.
 */
function buildThetaScanTransaction(overrides = {}) {
  return {
    block: '12345',
    fee_tfuel: 0,
    hash: '0xabcdef0000000000000000000000000000000000000000000000000000000001',
    recieving_address: '0x2222222222222222222222222222222222222222',
    sending_address: '0x1111111111111111111111111111111111111111',
    tfuel: '1.0',
    theta: '0.0',
    timestamp: 1700000000,
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('ThetaScanApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: ThetaScanApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('theta', 'thetascan');
    client = new ThetaScanApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(ThetaScanApiClient);
      expect(client.blockchain).toBe('theta');
      expect(client.name).toBe('thetascan');
    });

    it('should not require API key', () => {
      expect(thetaScanMetadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressTokenBalances');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('blockNumber');
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return TFUEL balance', async () => {
      mockGet.mockResolvedValue(
        ok({
          tfuel: 100,
          tfuel_staked: 0,
          theta: 50,
          theta_staked: 0,
        })
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toMatchObject({
        symbol: 'TFUEL',
        rawAmount: '100',
        decimals: 18,
      });
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(
        ok({
          tfuel: 0,
          tfuel_staked: 0,
          theta: 0,
          theta_staked: 0,
        })
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('0');
    });

    it('should reject invalid address', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'not-valid' }));
      expect(error.message).toContain('Invalid Theta address');
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Service unavailable')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Service unavailable');
    });
  });

  describe('execute - getAddressTokenBalances', () => {
    it('should return empty array when no contract addresses provided', async () => {
      const result = expectOk(await client.execute({ type: 'getAddressTokenBalances', address: TEST_ADDRESS }));
      expect(result).toHaveLength(0);
    });

    it('should return token balance for each contract', async () => {
      mockGet.mockResolvedValue(
        ok({
          balance: 1000000,
          contract_address: CONTRACT_ADDRESS,
          token_decimals: 6,
          token_name: 'USD Coin',
          token_symbol: 'USDC',
        })
      );

      const result = expectOk(
        await client.execute({
          type: 'getAddressTokenBalances',
          address: TEST_ADDRESS,
          contractAddresses: [CONTRACT_ADDRESS],
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        contractAddress: CONTRACT_ADDRESS,
        symbol: 'USDC',
        decimals: 6,
      });
    });

    it('should reject invalid address', async () => {
      const error = expectErr(
        await client.execute({
          type: 'getAddressTokenBalances',
          address: 'not-valid',
          contractAddresses: [CONTRACT_ADDRESS],
        })
      );
      expect(error.message).toContain('Invalid Theta address');
    });
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unsupported operation', async () => {
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
        streamType: 'token' as never,
      })) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Unsupported transaction type');
    });

    it('should stream normal transactions in a single batch', async () => {
      const tx = buildThetaScanTransaction();
      mockGet.mockResolvedValue(ok([tx]));

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
      expect(transactions[0]!.providerName).toBe('thetascan');
      expect(transactions[0]!.currency).toBe('TFUEL');
    });

    it('should handle empty transaction list', async () => {
      mockGet.mockResolvedValue(ok([]));

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
    it('should target zero address transactions endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toContain('transactions');
      expect(config.endpoint).toContain('0x0000000000000000000000000000000000000000');
    });

    it('should accept any non-null response', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({})).toBe(true);
      expect(validate([])).toBe(true);
      expect(validate({ block: 1 })).toBe(true);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
    });
  });
});
