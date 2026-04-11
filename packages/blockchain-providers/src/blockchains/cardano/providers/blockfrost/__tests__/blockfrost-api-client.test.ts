/* eslint-disable unicorn/no-null -- acceptable for tests */
import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  type MockHttpClient,
  resetMockHttpClient,
} from '../../../__tests__/test-utils.js';
import type { OneShotOperation } from '../../../../../contracts/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { CardanoTransaction } from '../../../schemas.js';
import { BlockfrostApiClient, blockfrostMetadata } from '../blockfrost.api-client.js';
import type { BlockfrostAddress, BlockfrostTransactionHash } from '../blockfrost.schemas.js';

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

const TEST_ADDRESS = 'addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2';
const BYRON_ADDRESS = 'DdzFFzCqrhsyLWVXEd1gB3UgcPMFrN7e7rZgFpZ1V2EYdqPwXU';

function buildAddressResponse(overrides?: Partial<BlockfrostAddress>): BlockfrostAddress {
  return {
    address: TEST_ADDRESS,
    amount: [{ quantity: '5000000', unit: 'lovelace' }],
    script: false,
    stake_address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
    type: 'shelley',
    ...overrides,
  };
}

function buildTransactionHashResponse(overrides?: Partial<BlockfrostTransactionHash>): BlockfrostTransactionHash {
  return {
    tx_hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
    tx_index: 5,
    block_height: 8129403,
    block_time: new Date('2024-01-15T10:30:00.000Z'),
    ...overrides,
  };
}

function buildTransactionDetailsResponse() {
  return {
    hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
    block: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
    block_height: 8129403,
    block_time: new Date('2024-01-15T10:30:00.000Z'),
    slot: 113456789,
    index: 5,
    fees: '170000',
    size: 300,
    utxo_count: 2,
    withdrawal_count: 0,
    mir_cert_count: 0,
    delegation_count: 0,
    stake_cert_count: 0,
    pool_update_count: 0,
    pool_retire_count: 0,
    asset_mint_or_burn_count: 0,
    redeemer_count: 0,
    valid_contract: true,
  };
}

function buildTransactionUtxosResponse() {
  return {
    hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
    inputs: [
      {
        address: TEST_ADDRESS,
        amount: [{ unit: 'lovelace', quantity: '5000000' }],
        tx_hash: 'b6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7',
        output_index: 0,
      },
    ],
    outputs: [
      {
        address: 'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
        amount: [{ unit: 'lovelace', quantity: '4830000' }],
        output_index: 0,
      },
    ],
  };
}

function buildTransactionWithdrawalsResponse() {
  return [
    {
      address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
      amount: '10524451',
    },
  ];
}

// ── Test suite ──────────────────────────────────────────────────────

describe('BlockfrostApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: BlockfrostApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    process.env['BLOCKFROST_API_KEY'] = 'test-api-key-123';

    const config = providerRegistry.createDefaultConfig('cardano', 'blockfrost');
    client = new BlockfrostApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(BlockfrostApiClient);
      expect(client.blockchain).toBe('cardano');
      expect(client.name).toBe('blockfrost');
    });

    it('should require API key', () => {
      expect(blockfrostMetadata.requiresApiKey).toBe(true);
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
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(10);
      expect(rateLimit.burstLimit).toBe(500);
      expect(rateLimit.requestsPerMinute).toBe(600);
      expect(rateLimit.requestsPerHour).toBe(36000);
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return balance data from lovelace amount', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ amount: [{ quantity: '5000000', unit: 'lovelace' }] })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'ADA',
        rawAmount: '5000000',
        decimalAmount: '5',
        decimals: 6,
      });
      expect(mockGet).toHaveBeenCalledWith(
        `/addresses/${TEST_ADDRESS}`,
        expect.objectContaining({
          headers: { project_id: 'test-api-key-123' },
        })
      );
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ amount: [{ quantity: '0', unit: 'lovelace' }] })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should handle Byron addresses', async () => {
      mockGet.mockResolvedValue(
        ok(
          buildAddressResponse({
            address: BYRON_ADDRESS,
            amount: [{ quantity: '2000000', unit: 'lovelace' }],
            type: 'byron',
          })
        )
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: BYRON_ADDRESS }));

      expect(result.decimalAmount).toBe('2');
      expect(result.symbol).toBe('ADA');
    });

    it('should handle addresses with multiple assets (ADA + native tokens)', async () => {
      mockGet.mockResolvedValue(
        ok(
          buildAddressResponse({
            amount: [
              { quantity: '5000000', unit: 'lovelace' },
              { quantity: '100', unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e' },
            ],
          })
        )
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      // Should extract only ADA balance
      expect(result.decimalAmount).toBe('5');
      expect(result.symbol).toBe('ADA');
    });

    it('should handle missing lovelace amount (returns zero)', async () => {
      mockGet.mockResolvedValue(
        ok(
          buildAddressResponse({
            amount: [{ quantity: '1000', unit: 'policyId123assetName' }],
          })
        )
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
      expect(result.symbol).toBe('ADA');
    });

    it('should handle empty amount array (zero balance)', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ amount: [] })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should handle very large balances without scientific notation', async () => {
      mockGet.mockResolvedValue(
        ok(buildAddressResponse({ amount: [{ quantity: '45000000000000', unit: 'lovelace' }] }))
      );

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('45000000');
      expect(result.decimalAmount).not.toContain('e');
    });

    it('should handle dust amounts (single lovelace)', async () => {
      mockGet.mockResolvedValue(ok(buildAddressResponse({ amount: [{ quantity: '1', unit: 'lovelace' }] })));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0.000001');
      expect(result.rawAmount).toBe('1');
    });

    it('should treat 404 as zero balance', async () => {
      mockGet.mockResolvedValue(err(new Error('404 Not Found')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should propagate non-404 API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Network timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network timeout');
    });
  });

  describe('execute - hasAddressTransactions', () => {
    it('should return true when transactions exist', async () => {
      mockGet.mockResolvedValue(ok([buildTransactionHashResponse()]));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(true);
    });

    it('should return false when no transactions', async () => {
      mockGet.mockResolvedValue(ok([]));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(false);
    });

    it('should treat 404 as no transactions', async () => {
      mockGet.mockResolvedValue(err(new Error('404 Not Found')));

      const result = expectOk(await client.execute({ type: 'hasAddressTransactions', address: TEST_ADDRESS }));

      expect(result).toBe(false);
    });

    it('should propagate non-404 API errors', async () => {
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

    it('should stream transactions with three-call pattern', async () => {
      // Call 1: Transaction hashes
      mockGet.mockResolvedValueOnce(ok([buildTransactionHashResponse()]));
      // Call 2: Transaction details
      mockGet.mockResolvedValueOnce(ok(buildTransactionDetailsResponse()));
      // Call 3: Transaction UTXOs
      mockGet.mockResolvedValueOnce(ok(buildTransactionUtxosResponse()));

      const transactions: CardanoTransaction[] = [];
      for await (const result of client.executeStreaming<CardanoTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe('a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4');
      expect(transactions[0]!.providerName).toBe('blockfrost');
      expect(transactions[0]!.currency).toBe('ADA');
      expect(transactions[0]!.status).toBe('success');
    });

    it('should fetch and map staking withdrawals when present', async () => {
      mockGet.mockResolvedValueOnce(ok([buildTransactionHashResponse()]));
      mockGet.mockResolvedValueOnce(ok({ ...buildTransactionDetailsResponse(), withdrawal_count: 1 }));
      mockGet.mockResolvedValueOnce(ok(buildTransactionUtxosResponse()));
      mockGet.mockResolvedValueOnce(ok(buildTransactionWithdrawalsResponse()));

      const transactions: CardanoTransaction[] = [];
      for await (const result of client.executeStreaming<CardanoTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions[0]?.withdrawals).toEqual([
        {
          address: 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha',
          amount: '10.524451',
          currency: 'ADA',
        },
      ]);
    });

    it('should handle 404 during streaming as empty result', async () => {
      mockGet.mockResolvedValue(err(new Error('404 Not Found')));

      const results = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        results.push(result);
      }

      // 404 treated as no transactions - stream should complete with empty batch
      expect(results).toHaveLength(1);
      const batch = expectOk(results[0]!);
      expect(batch.data).toHaveLength(0);
    });

    it('should propagate API errors during hash fetch', async () => {
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

    it('should propagate API errors during details fetch', async () => {
      // Hash fetch succeeds
      mockGet.mockResolvedValueOnce(ok([buildTransactionHashResponse()]));
      // Details fetch fails
      mockGet.mockResolvedValueOnce(err(new Error('Details fetch failed')));

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

    it('should propagate API errors during UTXO fetch', async () => {
      // Hash fetch succeeds
      mockGet.mockResolvedValueOnce(ok([buildTransactionHashResponse()]));
      // Details fetch succeeds
      mockGet.mockResolvedValueOnce(ok(buildTransactionDetailsResponse()));
      // UTXO fetch fails
      mockGet.mockResolvedValueOnce(err(new Error('UTXO fetch failed')));

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

    it('should send project_id header with all requests', async () => {
      // Single transaction - 3 API calls
      mockGet.mockResolvedValueOnce(ok([buildTransactionHashResponse()]));
      mockGet.mockResolvedValueOnce(ok(buildTransactionDetailsResponse()));
      mockGet.mockResolvedValueOnce(ok(buildTransactionUtxosResponse()));

      for await (const _ of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        // consume
      }

      // All 3 calls should include the API key header
      for (const call of mockGet.mock.calls) {
        expect(call[1]).toEqual(
          expect.objectContaining({
            headers: { project_id: 'test-api-key-123' },
          })
        );
      }
    });
  });

  describe('extractCursors', () => {
    it('should extract blockNumber and timestamp cursors', () => {
      const cursors = client.extractCursors({
        blockHeight: 8129403,
        timestamp: 1705312200000,
      } as CardanoTransaction);

      expect(cursors).toEqual([
        { type: 'blockNumber', value: 8129403 },
        { type: 'timestamp', value: 1705312200000 },
      ]);
    });

    it('should omit blockNumber when blockHeight is undefined', () => {
      const cursors = client.extractCursors({
        timestamp: 1705312200000,
      } as CardanoTransaction);

      expect(cursors).toEqual([{ type: 'timestamp', value: 1705312200000 }]);
    });

    it('should return empty array when no cursor data available', () => {
      const cursors = client.extractCursors({} as CardanoTransaction);
      expect(cursors).toEqual([]);
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
      const cursor = { type: 'timestamp' as const, value: 1705312200000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through pageToken cursors unchanged', () => {
      const cursor = { type: 'pageToken' as const, value: '5', providerName: 'blockfrost' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target /health endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/health');
    });

    it('should validate healthy response', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ is_healthy: true })).toBe(true);
    });

    it('should reject unhealthy response', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ is_healthy: false })).toBe(false);
    });

    it('should reject invalid responses', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({})).toBe(false);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
    });
  });
});
