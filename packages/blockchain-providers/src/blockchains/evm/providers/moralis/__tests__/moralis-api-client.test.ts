/* eslint-disable unicorn/no-null -- acceptable for tests */
import { err, ok } from '@exitbook/foundation';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { MoralisApiClient, moralisMetadata } from '../moralis.api-client.js';

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
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';

const createNativeTransfer = (overrides: Record<string, unknown> = {}) => ({
  direction: 'receive',
  from_address: OTHER_ADDRESS,
  from_address_label: null,
  internal_transaction: false,
  to_address: TEST_ADDRESS,
  to_address_label: null,
  token_symbol: 'ETH',
  value: '1000000000000000000',
  value_formatted: '1.0',
  ...overrides,
});

const createErc20Transfer = (overrides: Record<string, unknown> = {}) => ({
  address: CONTRACT_ADDRESS,
  direction: 'receive',
  from_address: OTHER_ADDRESS,
  from_address_label: null,
  log_index: 7,
  possible_spam: false,
  security_score: null,
  to_address: TEST_ADDRESS,
  to_address_label: null,
  token_decimals: '6',
  token_logo: null,
  token_name: 'USD Coin',
  token_symbol: 'USDC',
  value: '1000000',
  value_formatted: '1.0',
  verified_contract: true,
  ...overrides,
});

const createWalletHistoryItem = (overrides: Record<string, unknown> = {}) => ({
  block_hash: '0xabcdef0000000000000000000000000000000000000000000000000000000000',
  block_number: '12345',
  block_timestamp: 1700000000,
  category: 'receive',
  erc20_transfers: [],
  from_address: OTHER_ADDRESS,
  gas_price: '1000000000',
  hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
  internal_transactions: [],
  method_label: null,
  native_transfers: [createNativeTransfer()],
  nonce: '0',
  possible_spam: false,
  receipt_gas_used: '21000',
  receipt_status: '1',
  summary: 'Received 1 ETH',
  to_address: TEST_ADDRESS,
  transaction_fee: '0.000021',
  value: '1000000000000000000',
  ...overrides,
});

// ── Test suite ──────────────────────────────────────────────────────

describe('MoralisApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: MoralisApiClient;
  let mockGet: MockHttpClient['get'];
  const originalMoralisApiKey = process.env['MORALIS_API_KEY'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);
    process.env['MORALIS_API_KEY'] = 'test-moralis-api-key';

    const config = providerRegistry.createDefaultConfig('ethereum', 'moralis');
    client = new MoralisApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  afterAll(() => {
    if (originalMoralisApiKey === undefined) {
      delete process.env['MORALIS_API_KEY'];
      return;
    }

    process.env['MORALIS_API_KEY'] = originalMoralisApiKey;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(MoralisApiClient);
      expect(client.blockchain).toBe('ethereum');
      expect(client.name).toBe('moralis');
    });

    it('should require API key', () => {
      expect(moralisMetadata.requiresApiKey).toBe(true);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedOperations).toContain('getAddressTokenBalances');
      expect(capabilities.supportedOperations).toContain('getTokenMetadata');
      expect(capabilities.preferredCursorType).toBe('pageToken');
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return native balance data', async () => {
      mockGet.mockResolvedValue(ok({ balance: '1000000000000000000' }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toMatchObject({
        symbol: 'ETH',
        rawAmount: '1000000000000000000',
        decimals: 18,
      });
      expect(result.decimalAmount).toBe('1');
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Unauthorized')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Unauthorized');
    });
  });

  describe('execute - getAddressTokenBalances', () => {
    it('should return token balance data', async () => {
      mockGet.mockResolvedValue(
        ok([
          {
            balance: '1000000',
            decimals: 6,
            logo: null,
            name: 'USD Coin',
            symbol: 'USDC',
            token_address: CONTRACT_ADDRESS,
          },
        ])
      );

      const result = expectOk(
        await client.execute({
          type: 'getAddressTokenBalances',
          address: TEST_ADDRESS,
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        symbol: 'USDC',
        rawAmount: '1000000',
        decimals: 6,
        contractAddress: CONTRACT_ADDRESS,
      });
    });

    it('should skip tokens with missing decimals', async () => {
      mockGet.mockResolvedValue(
        ok([
          {
            balance: '1000000',
            decimals: null,
            logo: null,
            name: 'Unknown Token',
            symbol: 'UNK',
            token_address: CONTRACT_ADDRESS,
          },
        ])
      );

      const result = expectOk(
        await client.execute({
          type: 'getAddressTokenBalances',
          address: TEST_ADDRESS,
        })
      );

      // Token with null decimals should be skipped
      expect(result).toHaveLength(0);
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Bad request')));

      const error = expectErr(
        await client.execute({
          type: 'getAddressTokenBalances',
          address: TEST_ADDRESS,
        })
      );

      expect(error.message).toBe('Bad request');
    });
  });

  describe('execute - getTokenMetadata', () => {
    it('should return empty array for no contract addresses', async () => {
      const result = expectOk(await client.execute({ type: 'getTokenMetadata', contractAddresses: [] }));
      expect(result).toHaveLength(0);
    });

    it('should return token metadata', async () => {
      mockGet.mockResolvedValue(
        ok([
          {
            address: CONTRACT_ADDRESS,
            decimals: 6,
            logo: null,
            name: 'USD Coin',
            symbol: 'USDC',
            possible_spam: false,
            verified_contract: true,
            total_supply: null,
            created_at: null,
            block_number: null,
          },
        ])
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

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Server error')));

      const error = expectErr(
        await client.execute({
          type: 'getTokenMetadata',
          contractAddresses: [CONTRACT_ADDRESS],
        })
      );

      expect(error.message).toBe('Server error');
    });
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unsupported operation', async () => {
      const error = expectErr(
        await client.execute({
          type: 'getAddressInfo',
          address: TEST_ADDRESS,
        } as unknown as OneShotOperation)
      );

      expect(error.message).toContain('Unsupported operation');
    });
  });

  describe('executeStreaming', () => {
    it('should yield error for non-getAddressTransactions operation', async () => {
      const results = [];
      for await (const result of client.executeStreaming<EvmTransaction>({
        type: 'getAddressBalances',
        address: TEST_ADDRESS,
      } as never)) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      const error = expectErr(results[0]!);
      expect(error.message).toContain('Streaming not yet implemented');
    });

    it('should stream internal transactions for internal stream type', async () => {
      mockGet.mockResolvedValue(
        ok({
          cursor: null,
          page: 1,
          page_size: 100,
          result: [
            createWalletHistoryItem({
              native_transfers: [
                createNativeTransfer({ internal_transaction: false }),
                createNativeTransfer({
                  internal_transaction: true,
                  value: '500000000000000000',
                  value_formatted: '0.5',
                }),
              ],
            }),
          ],
        })
      );

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
      expect(transactions[0]!.amount).toBe('500000000000000000');
      expect(mockGet.mock.calls[0]?.[0]).toContain('include_internal_transactions=true');
    });

    it('should stream token transfers for token stream type', async () => {
      mockGet.mockResolvedValue(
        ok({
          cursor: null,
          page: 1,
          page_size: 100,
          result: [
            createWalletHistoryItem({
              erc20_transfers: [createErc20Transfer()],
              value: '0',
            }),
          ],
        })
      );

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
      expect(transactions[0]!.tokenAddress).toBe(CONTRACT_ADDRESS);
    });

    it('should retain token transfers with missing token decimals', async () => {
      mockGet.mockResolvedValue(
        ok({
          cursor: null,
          page: 1,
          page_size: 100,
          result: [
            createWalletHistoryItem({
              erc20_transfers: [createErc20Transfer({ token_decimals: null })],
              value: '0',
            }),
          ],
        })
      );

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
      expect(transactions[0]!.tokenAddress).toBe(CONTRACT_ADDRESS);
      expect(transactions[0]!.tokenDecimals).toBeUndefined();
    });

    it('should propagate API errors during normal streaming', async () => {
      mockGet.mockResolvedValue(err(new Error('Service unavailable')));

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

    it('should accept null receipt status from wallet history', async () => {
      mockGet.mockResolvedValue(
        ok({
          cursor: null,
          page: 1,
          page_size: 100,
          result: [createWalletHistoryItem({ receipt_status: null })],
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
      expect(transactions[0]!.status).toBe('success');
    });

    it('should stream normal wallet history transactions without leaking token or internal events', async () => {
      mockGet.mockResolvedValue(
        ok({
          cursor: null,
          page: 1,
          page_size: 100,
          result: [
            createWalletHistoryItem({
              erc20_transfers: [createErc20Transfer()],
              native_transfers: [
                createNativeTransfer({ internal_transaction: false }),
                createNativeTransfer({
                  internal_transaction: true,
                  value: '500000000000000000',
                  value_formatted: '0.5',
                }),
              ],
            }),
          ],
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
      expect(transactions[0]!.providerName).toBe('moralis');
      expect(transactions[0]!.type).toBe('transfer');
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
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 0 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 0 });
    });

    it('should pass through non-blockNumber cursors unchanged', () => {
      const cursor = { type: 'pageToken' as const, value: 'some-cursor-token', providerName: 'moralis' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target dateToBlock endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toContain('dateToBlock');
      expect(config.endpoint).toContain('chain=eth');
    });

    it('should validate response with block number', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ block: 12345 })).toBe(true);
      expect(validate({ block: 0 })).toBe(true);
      expect(validate({})).toBeFalsy();
      expect(validate({ block: 'not-a-number' })).toBeFalsy();
      expect(validate(null)).toBeFalsy();
    });
  });
});
