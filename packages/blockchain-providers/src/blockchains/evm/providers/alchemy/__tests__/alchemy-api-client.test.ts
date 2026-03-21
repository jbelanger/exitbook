/* eslint-disable unicorn/no-null -- acceptable for tests */
import { err, ok } from '@exitbook/core';
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
import { AlchemyApiClient, alchemyMetadata } from '../alchemy.api-client.js';

// ── Module-level mocks (hoisted by vitest) ──────────────────────────

// Both httpClient (BaseApiClient) and portfolioClient (Alchemy-specific)
// are constructed via `new HttpClient()`. The mock returns the same instance
// for both, so mockHttp controls all HTTP interactions in these unit tests.
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

function buildPortfolioBalanceResponse(tokenAddress: string | null, tokenBalance: string) {
  return {
    data: {
      tokens: [
        {
          address: TEST_ADDRESS,
          network: 'eth-mainnet',
          tokenAddress,
          tokenBalance,
          tokenMetadata: {
            decimals: 18,
            logo: null,
            name: 'Ether',
            symbol: 'ETH',
          },
        },
      ],
    },
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('AlchemyApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: AlchemyApiClient;
  let mockPost: MockHttpClient['post'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('ethereum', 'alchemy');
    client = new AlchemyApiClient(config);
    injectMockHttpClient(client, mockHttp);
    // portfolioClient is a separate HttpClient instance — inject mock separately
    Object.defineProperty(client, 'portfolioClient', { configurable: true, value: mockHttp, writable: true });
    mockPost = mockHttp.post;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(AlchemyApiClient);
      expect(client.blockchain).toBe('ethereum');
      expect(client.name).toBe('alchemy');
    });

    it('should require API key', () => {
      expect(alchemyMetadata.requiresApiKey).toBe(true);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressInfo');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toContain('getAddressTokenBalances');
      expect(capabilities.supportedOperations).toContain('getTokenMetadata');
      expect(capabilities.preferredCursorType).toBe('pageToken');
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });

    it('should filter transaction types by ethereum chain config', () => {
      const { capabilities } = client;
      // Ethereum supports normal, internal, token (beacon_withdrawal filtered at chain level)
      expect(capabilities.supportedTransactionTypes).toContain('normal');
      expect(capabilities.supportedTransactionTypes).toContain('internal');
      expect(capabilities.supportedTransactionTypes).toContain('token');
    });
  });

  describe('execute - getAddressInfo', () => {
    it('should return isContract false for EOA address (0x code)', async () => {
      mockPost.mockResolvedValue(ok({ id: 1, jsonrpc: '2.0', result: '0x' }));

      const result = expectOk(await client.execute({ type: 'getAddressInfo', address: TEST_ADDRESS }));

      expect(result.isContract).toBe(false);
      expect(result.code).toBe('0x');
    });

    it('should return isContract true for contract address (has bytecode)', async () => {
      mockPost.mockResolvedValue(ok({ id: 1, jsonrpc: '2.0', result: '0x6080604052' }));

      const result = expectOk(await client.execute({ type: 'getAddressInfo', address: TEST_ADDRESS }));

      expect(result.isContract).toBe(true);
    });

    it('should propagate API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Network error')));

      const error = expectErr(await client.execute({ type: 'getAddressInfo', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network error');
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return native balance when native token found', async () => {
      // portfolioClient.post() → same mockHttp.post since both share the mock
      mockPost.mockResolvedValue(ok(buildPortfolioBalanceResponse(null, '2000000000000000000')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toMatchObject({
        symbol: 'ETH',
        rawAmount: '2000000000000000000',
        decimals: 18,
      });
    });

    it('should return zero balance when no native token in response', async () => {
      mockPost.mockResolvedValue(ok({ data: { tokens: [] } }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('0');
    });

    it('should propagate API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Unauthorized')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Unauthorized');
    });
  });

  describe('execute - getAddressTokenBalances', () => {
    it('should return token balances, filtering zero values', async () => {
      mockPost.mockResolvedValue(
        ok({
          data: {
            tokens: [
              {
                address: TEST_ADDRESS,
                network: 'eth-mainnet',
                tokenAddress: CONTRACT_ADDRESS,
                tokenBalance: '1000000',
                tokenMetadata: { decimals: 6, logo: null, name: 'USD Coin', symbol: 'USDC' },
              },
              {
                address: TEST_ADDRESS,
                network: 'eth-mainnet',
                tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                tokenBalance: '0',
                tokenMetadata: { decimals: 18, logo: null, name: 'Zero Token', symbol: 'ZERO' },
              },
            ],
          },
        })
      );

      const result = expectOk(
        await client.execute({
          type: 'getAddressTokenBalances',
          address: TEST_ADDRESS,
        })
      );

      // Only non-zero balances are returned
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        contractAddress: CONTRACT_ADDRESS,
        rawAmount: '1000000',
      });
    });

    it('should propagate API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Rate limited')));

      const error = expectErr(
        await client.execute({
          type: 'getAddressTokenBalances',
          address: TEST_ADDRESS,
        })
      );

      expect(error.message).toBe('Rate limited');
    });
  });

  describe('execute - getTokenMetadata', () => {
    it('should return empty array for no contract addresses', async () => {
      const result = expectOk(await client.execute({ type: 'getTokenMetadata', contractAddresses: [] }));
      expect(result).toHaveLength(0);
    });

    it('should fetch metadata for contract addresses', async () => {
      mockPost.mockResolvedValue(
        ok({
          id: 1,
          jsonrpc: '2.0',
          result: { symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: null },
        })
      );

      const result = expectOk(
        await client.execute({
          type: 'getTokenMetadata',
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
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unsupported operation', async () => {
      const error = expectErr(
        await client.execute({
          type: 'hasAddressTransactions',
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
        streamType: 'beacon_withdrawal' as never,
      })) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Unsupported transaction type');
    });

    it('should propagate API errors during streaming', async () => {
      mockPost.mockResolvedValue(err(new Error('Server error')));

      let gotError = false;
      for await (const result of client.executeStreaming<EvmTransaction>({
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
    it('should target JSON-RPC eth_blockNumber via POST', () => {
      const config = client.getHealthCheckConfig();
      expect(config.method).toBe('POST');
      expect(config.body).toMatchObject({
        method: 'eth_blockNumber',
        jsonrpc: '2.0',
      });
    });

    it('should validate response with result field present', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ result: '0xf4240' })).toBe(true);
      expect(validate({ result: '' })).toBe(true);
      expect(validate({})).toBeFalsy();
      expect(validate(null)).toBeFalsy();
    });
  });
});
