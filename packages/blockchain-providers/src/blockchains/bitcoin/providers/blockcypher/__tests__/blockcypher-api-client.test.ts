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
import { BlockCypherApiClient, blockcypherMetadata } from '../blockcypher.api-client.js';
import type { BlockCypherAddress, BlockCypherTransaction } from '../blockcypher.schemas.js';

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

function buildAddressResponse(overrides?: Partial<BlockCypherAddress>): BlockCypherAddress {
  return {
    address: TEST_ADDRESS,
    balance: 5000000000,
    final_balance: 5000000000,
    final_n_tx: 10,
    n_tx: 10,
    total_received: 10000000000,
    total_sent: 5000000000,
    unconfirmed_balance: 0,
    unconfirmed_n_tx: 0,
    ...overrides,
  };
}

function buildTransactionResponse(overrides?: Partial<BlockCypherTransaction>): BlockCypherTransaction {
  return {
    block_hash: '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72f9a4670',
    block_height: 800000,
    block_index: 0,
    confidence: 1,
    confirmations: 100,
    confirmed: '2023-07-01T12:00:00Z',
    double_spend: false,
    fees: 5000,
    hash: 'abc123txhash',
    inputs: [
      {
        addresses: ['1InputAddress'],
        age: 799999,
        output_index: 0,
        output_value: 100000,
        prev_hash: 'prev-hash-123',
        script_type: 'pay-to-pubkey-hash',
        sequence: 4294967295,
      },
    ],
    lock_time: 0,
    next_inputs: undefined,
    next_outputs: undefined,
    outputs: [
      {
        addresses: ['1OutputAddress'],
        script: '76a914...88ac',
        script_type: 'pay-to-pubkey-hash',
        value: 95000,
      },
    ],
    preference: 'high',
    received: '2023-07-01T11:59:00Z',
    size: 250,
    total: 95000,
    ver: 2,
    vin_sz: 1,
    vout_sz: 1,
    vsize: 250,
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('BlockCypherApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: BlockCypherApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env['BLOCKCYPHER_API_KEY'];
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('bitcoin', 'blockcypher');
    client = new BlockCypherApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(BlockCypherApiClient);
      expect(client.blockchain).toBe('bitcoin');
      expect(client.name).toBe('blockcypher');
    });

    it('should not require API key', () => {
      expect(blockcypherMetadata.requiresApiKey).toBe(false);
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

    it('should support three cursor types', () => {
      expect(client.capabilities.supportedCursorTypes).toEqual(['pageToken', 'blockNumber', 'timestamp']);
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
        `/addrs/${TEST_ADDRESS}/balance`,
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ final_balance: 0 })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should handle small satoshi amounts', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ final_balance: 1 })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('1');
      expect(result.decimalAmount).toBe('0.00000001');
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Network timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network timeout');
    });
  });

  describe('execute - hasAddressTransactions', () => {
    it('should return true when final_n_tx > 0', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ final_n_tx: 5 })));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(true);
    });

    it('should return false when final_n_tx is 0', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ final_n_tx: 0 })));

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

    it('should stream transactions with pagination via txrefs', async () => {
      const txResponse = buildTransactionResponse();

      // First call: address with txrefs (single page, < 50 refs = complete)
      mockGet
        .mockResolvedValueOnce(
          ok(
            buildAddressResponse({
              txrefs: [
                {
                  block_height: 800000,
                  confirmations: 100,
                  confirmed: '2023-07-01T12:00:00Z',
                  double_spend: false,
                  ref_balance: 95000,
                  spent: false,
                  tx_hash: 'abc123txhash',
                  tx_input_n: -1,
                  tx_output_n: 0,
                  value: 95000,
                },
              ],
            })
          )
        )
        // Second call: fetch full transaction details
        .mockResolvedValueOnce(ok(txResponse));

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
      expect(transactions[0]!.providerName).toBe('blockcypher');
      expect(transactions[0]!.status).toBe('success');
    });

    it('should handle empty txrefs (no transactions)', async () => {
      mockGet.mockResolvedValueOnce(ok(buildAddressResponse({ txrefs: [] })));

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

    it('should handle null txrefs', async () => {
      mockGet.mockResolvedValueOnce(ok(buildAddressResponse({ txrefs: null })));

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

    it('should deduplicate txrefs with same hash', async () => {
      const txResponse = buildTransactionResponse();

      // Address response with duplicate tx_hash entries (same tx appears as input and output ref)
      mockGet
        .mockResolvedValueOnce(
          ok(
            buildAddressResponse({
              txrefs: [
                {
                  block_height: 800000,
                  confirmations: 100,
                  confirmed: '2023-07-01T12:00:00Z',
                  double_spend: false,
                  ref_balance: 95000,
                  spent: false,
                  tx_hash: 'abc123txhash',
                  tx_input_n: -1,
                  tx_output_n: 0,
                  value: 95000,
                },
                {
                  block_height: 800000,
                  confirmations: 100,
                  confirmed: '2023-07-01T12:00:00Z',
                  double_spend: false,
                  ref_balance: 0,
                  spent: true,
                  tx_hash: 'abc123txhash', // Same hash, different ref
                  tx_input_n: 0,
                  tx_output_n: -1,
                  value: 100000,
                },
              ],
            })
          )
        )
        .mockResolvedValueOnce(ok(txResponse));

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      // Should only fetch and return the transaction once despite two refs
      expect(transactions).toHaveLength(1);
      expect(mockGet).toHaveBeenCalledTimes(2); // 1 address + 1 tx fetch (not 2 tx fetches)
    });

    it('should skip transactions that fail to fetch', async () => {
      const txResponse = buildTransactionResponse({ hash: 'good-tx' });

      mockGet
        .mockResolvedValueOnce(
          ok(
            buildAddressResponse({
              txrefs: [
                {
                  block_height: 800000,
                  confirmations: 100,
                  confirmed: '2023-07-01T12:00:00Z',
                  double_spend: false,
                  ref_balance: 95000,
                  spent: false,
                  tx_hash: 'bad-tx',
                  tx_input_n: -1,
                  tx_output_n: 0,
                  value: 95000,
                },
                {
                  block_height: 800001,
                  confirmations: 99,
                  confirmed: '2023-07-01T12:10:00Z',
                  double_spend: false,
                  ref_balance: 190000,
                  spent: false,
                  tx_hash: 'good-tx',
                  tx_input_n: -1,
                  tx_output_n: 0,
                  value: 95000,
                },
              ],
            })
          )
        )
        // First tx fetch fails
        .mockResolvedValueOnce(err(new Error('TX not found')))
        // Second tx fetch succeeds
        .mockResolvedValueOnce(ok(txResponse));

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe('good-tx');
    });
  });

  describe('fetchCompleteTransaction - paginated inputs/outputs', () => {
    it('should fetch paginated outputs', async () => {
      const txWithPaginatedOutputs = buildTransactionResponse({
        next_outputs: 'https://api.blockcypher.com/v1/btc/main/txs/abc123?outstart=50',
      });

      mockGet
        // Address with txrefs
        .mockResolvedValueOnce(
          ok(
            buildAddressResponse({
              txrefs: [
                {
                  block_height: 800000,
                  confirmations: 100,
                  confirmed: '2023-07-01T12:00:00Z',
                  double_spend: false,
                  ref_balance: 95000,
                  spent: false,
                  tx_hash: 'abc123txhash',
                  tx_input_n: -1,
                  tx_output_n: 0,
                  value: 95000,
                },
              ],
            })
          )
        )
        // Initial tx fetch (has next_outputs)
        .mockResolvedValueOnce(ok(txWithPaginatedOutputs))
        // Paginated outputs fetch (no more pages)
        .mockResolvedValueOnce(
          ok({
            outputs: [
              {
                addresses: ['1MoreOutputAddr'],
                script: '76a914...88ac',
                script_type: 'pay-to-pubkey-hash',
                value: 50000,
              },
            ],
          })
        );

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      // 1 original output + 1 paginated output
      expect(transactions[0]!.outputs).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledTimes(3); // address + initial tx + paginated outputs
    });

    it('should fetch paginated inputs', async () => {
      const txWithPaginatedInputs = buildTransactionResponse({
        next_inputs: 'https://api.blockcypher.com/v1/btc/main/txs/abc123?instart=50',
      });

      mockGet
        .mockResolvedValueOnce(
          ok(
            buildAddressResponse({
              txrefs: [
                {
                  block_height: 800000,
                  confirmations: 100,
                  confirmed: '2023-07-01T12:00:00Z',
                  double_spend: false,
                  ref_balance: 95000,
                  spent: false,
                  tx_hash: 'abc123txhash',
                  tx_input_n: -1,
                  tx_output_n: 0,
                  value: 95000,
                },
              ],
            })
          )
        )
        // Initial tx fetch (has next_inputs)
        .mockResolvedValueOnce(ok(txWithPaginatedInputs))
        // Paginated inputs fetch
        .mockResolvedValueOnce(
          ok({
            inputs: [
              {
                addresses: ['1MoreInputAddr'],
                age: 799998,
                output_index: 1,
                output_value: 50000,
                prev_hash: 'prev-hash-456',
                script_type: 'pay-to-pubkey-hash',
                sequence: 4294967295,
              },
            ],
          })
        );

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.inputs).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it('should continue when paginated output fetch fails', async () => {
      const txWithPaginatedOutputs = buildTransactionResponse({
        next_outputs: 'https://api.blockcypher.com/v1/btc/main/txs/abc123?outstart=50',
      });

      mockGet
        .mockResolvedValueOnce(
          ok(
            buildAddressResponse({
              txrefs: [
                {
                  block_height: 800000,
                  confirmations: 100,
                  confirmed: '2023-07-01T12:00:00Z',
                  double_spend: false,
                  ref_balance: 95000,
                  spent: false,
                  tx_hash: 'abc123txhash',
                  tx_input_n: -1,
                  tx_output_n: 0,
                  value: 95000,
                },
              ],
            })
          )
        )
        .mockResolvedValueOnce(ok(txWithPaginatedOutputs))
        // Paginated outputs fetch fails — should not break the transaction
        .mockResolvedValueOnce(err(new Error('Pagination failed')));

      const transactions: BitcoinTransaction[] = [];
      for await (const result of client.executeStreaming<BitcoinTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      // Transaction should still be returned with its original outputs
      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.outputs).toHaveLength(1);
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

    it('should omit timestamp when falsy', () => {
      const cursors = client.extractCursors({
        blockHeight: 800000,
        timestamp: 0,
      } as BitcoinTransaction);

      expect(cursors).toEqual([{ type: 'blockNumber', value: 800000 }]);
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
      const cursor = { type: 'pageToken' as const, value: '50', providerName: 'blockcypher' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target root endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/');
    });

    it('should validate response with name field', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ name: 'BTC.main' })).toBe(true);
      expect(validate({ name: '' })).toBe(false);
      expect(validate({})).toBe(false);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
    });
  });

  describe('API key handling', () => {
    it('should append token param when API key is set via env', async () => {
      vi.stubEnv('BLOCKCYPHER_API_KEY', 'test-api-key');

      const config = providerRegistry.createDefaultConfig('bitcoin', 'blockcypher');
      const clientWithKey = new BlockCypherApiClient(config);
      injectMockHttpClient(clientWithKey, mockHttp);

      mockHttp.get.mockResolvedValue(ok(buildAddressResponse()));

      expectOk(await clientWithKey.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(mockHttp.get).toHaveBeenCalledWith(expect.stringContaining('token=test-api-key'), expect.anything());
    });

    it('should not append token param when no API key is set', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse()));

      expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(mockGet).toHaveBeenCalledWith(`/addrs/${TEST_ADDRESS}/balance`, expect.anything());
    });
  });
});
