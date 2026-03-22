/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
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
import type { SubstrateTransaction } from '../../../types.js';
import { TaostatsApiClient, taostatsMetadata } from '../taostats.api-client.js';
import type { TaostatsBalanceResponse, TaostatsTransaction } from '../taostats.schemas.js';

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

// ── Fixtures ─────────────────────────────────────────────────────────

// Alice and Bob — well-known generic-SS58 (format 42) test accounts (also valid for Bittensor)
const TEST_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const OTHER_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const TX_HASH = '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1';

// Hex keys for Alice/Bob in Substrate test accounts
const FROM_HEX = '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d';
const TO_HEX = '0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48';

function buildBalanceResponse(balanceTotal = '1000000000'): TaostatsBalanceResponse {
  return {
    data: [
      {
        address: { hex: FROM_HEX, ss58: TEST_ADDRESS },
        alpha_balances: null,
        alpha_balances_24hr_ago: null,
        balance_free: '500000000',
        balance_free_24hr_ago: null,
        balance_staked: '500000000',
        balance_staked_24hr_ago: null,
        balance_staked_alpha_as_tao: '0',
        balance_staked_alpha_as_tao_24hr_ago: null,
        balance_staked_root: '500000000',
        balance_staked_root_24hr_ago: null,
        balance_total: balanceTotal,
        balance_total_24hr_ago: null,
        block_number: 3500000,
        coldkey_swap: null,
        created_on_date: '2023-01-01T00:00:00Z',
        created_on_network: 'finney',
        network: 'finney',
        rank: 1,
        timestamp: '2024-01-15T10:00:00Z',
      },
    ],
  };
}

function buildTransaction(overrides?: Partial<TaostatsTransaction>): TaostatsTransaction {
  return {
    amount: '1000000000',
    block_number: 3500000,
    extrinsic_id: '3500000-0',
    fee: '125000',
    from: { hex: FROM_HEX, ss58: TEST_ADDRESS },
    id: 'transfer-1',
    network: 'finney',
    timestamp: new Date('2024-01-15T10:00:00Z'),
    to: { hex: TO_HEX, ss58: OTHER_ADDRESS },
    transaction_hash: TX_HASH,
    ...overrides,
  };
}

function buildTransactionsResponse(data: TaostatsTransaction[] = [buildTransaction()]) {
  return { data };
}

// ── Test suite ────────────────────────────────────────────────────────

describe('TaostatsApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: TaostatsApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    client = new TaostatsApiClient(providerRegistry.createDefaultConfig('bittensor', 'taostats'));
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  // ── metadata ─────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(TaostatsApiClient);
      expect(client.blockchain).toBe('bittensor');
      expect(client.name).toBe('taostats');
    });

    it('should require an API key', () => {
      expect(taostatsMetadata.requiresApiKey).toBe(true);
    });

    it('should support getAddressTransactions and getAddressBalances', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
    });

    it('should prefer blockNumber cursor', () => {
      expect(client.capabilities.preferredCursorType).toBe('blockNumber');
    });
  });

  // ── execute: getAddressBalances ───────────────────────────────────

  describe('execute - getAddressBalances', () => {
    it('should return converted balance when API responds successfully', async () => {
      // 1 TAO = 1_000_000_000 rao (9 decimals)
      mockGet.mockResolvedValue(ok(buildBalanceResponse('1000000000')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.symbol).toBe('TAO');
      expect(result.rawAmount).toBe('1000000000');
      expect(result.decimalAmount).toBe('1');
      expect(result.decimals).toBe(9);
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining(`address=${TEST_ADDRESS}`),
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('network=finney'), expect.anything());
    });

    it('should return zero balance when data array is empty', async () => {
      mockGet.mockResolvedValue(ok({ data: [] }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('0');
      expect(result.decimalAmount).toBe('0');
    });

    it('should return zero balance when data is absent', async () => {
      mockGet.mockResolvedValue(ok({ data: null }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('0');
    });

    it('should return error for invalid address without calling the API', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'not-an-ss58-address' }));

      expect(error.message).toContain('Invalid SS58 address');
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should propagate HTTP errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Network timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network timeout');
    });
  });

  // ── execute: unsupported operation ───────────────────────────────

  describe('execute - unsupported operation', () => {
    it('should return error for unrecognised operation type', async () => {
      const error = expectErr(
        await client.execute({ type: 'getTokenMetadata', address: TEST_ADDRESS } as unknown as OneShotOperation)
      );

      expect(error.message).toContain('Unsupported operation');
    });
  });

  // ── executeStreaming ──────────────────────────────────────────────

  describe('executeStreaming', () => {
    it('should yield error for unsupported streaming operation', async () => {
      const results = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressBalances',
        address: TEST_ADDRESS,
      } as never)) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      expect(expectErr(results[0]!).message).toContain('Streaming not yet implemented');
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
      expect(expectErr(results[0]!).message).toContain('Unsupported transaction type');
    });

    it('should stream transactions and map them to SubstrateTransactions', async () => {
      mockGet.mockResolvedValue(ok(buildTransactionsResponse([buildTransaction()])));

      const transactions: SubstrateTransaction[] = [];
      for await (const result of client.executeStreaming<SubstrateTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe(TX_HASH);
      expect(transactions[0]!.from).toBe(TEST_ADDRESS);
      expect(transactions[0]!.to).toBe(OTHER_ADDRESS);
      expect(transactions[0]!.providerName).toBe('taostats');
      expect(transactions[0]!.status).toBe('success');
      expect(transactions[0]!.amount).toBe('1000000000');
    });

    it('should paginate using offset until response returns fewer than 100 items', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) =>
        buildTransaction({ transaction_hash: `0x${i.toString().padStart(64, '0')}`, extrinsic_id: `3500000-${i}` })
      );
      const page2 = [buildTransaction({ transaction_hash: '0x' + 'f'.repeat(64), extrinsic_id: '3600000-0' })];

      mockGet
        .mockResolvedValueOnce(ok(buildTransactionsResponse(page1)))
        .mockResolvedValueOnce(ok(buildTransactionsResponse(page2)));

      const transactions: SubstrateTransaction[] = [];
      for await (const result of client.executeStreaming<SubstrateTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(101);
      expect(mockGet).toHaveBeenCalledTimes(2);
      // First call uses offset=0, second uses offset=100
      expect(mockGet).toHaveBeenNthCalledWith(1, expect.stringContaining('offset=0'), expect.anything());
      expect(mockGet).toHaveBeenNthCalledWith(2, expect.stringContaining('offset=100'), expect.anything());
    });

    it('should complete immediately when transactions list is empty', async () => {
      mockGet.mockResolvedValue(ok(buildTransactionsResponse([])));

      const transactions: SubstrateTransaction[] = [];
      for await (const result of client.executeStreaming<SubstrateTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        transactions.push(...expectOk(result).data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should propagate streaming API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Unauthorized')));

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

    it('should silently skip transactions not relevant to the requested address', async () => {
      // Taostats filters irrelevant transfers in fetchPage (before mapItem) using
      // isTransactionRelevant, so unrelated transactions produce an empty batch.
      const irrelevant = buildTransaction({
        from: { hex: TO_HEX, ss58: OTHER_ADDRESS },
        to: { hex: '0x' + '1'.repeat(64), ss58: '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy' },
      });
      mockGet.mockResolvedValue(ok(buildTransactionsResponse([irrelevant])));

      const transactions: SubstrateTransaction[] = [];
      for await (const result of client.executeStreaming<SubstrateTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        transactions.push(...expectOk(result).data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
    });
  });

  // ── extractCursors ────────────────────────────────────────────────

  describe('extractCursors', () => {
    it('should return blockNumber and timestamp cursors when both are present', () => {
      const tx = { timestamp: 1705312800000, blockHeight: 3500000 } as SubstrateTransaction;
      const cursors = client.extractCursors(tx);

      expect(cursors).toEqual([
        { type: 'blockNumber', value: 3500000 },
        { type: 'timestamp', value: 1705312800000 },
      ]);
    });

    it('should omit blockNumber cursor when blockHeight is undefined', () => {
      const cursors = client.extractCursors({ timestamp: 1705312800000 } as SubstrateTransaction);

      expect(cursors).toEqual([{ type: 'timestamp', value: 1705312800000 }]);
    });

    it('should omit timestamp cursor when timestamp is falsy', () => {
      const cursors = client.extractCursors({ timestamp: 0, blockHeight: 3500000 } as SubstrateTransaction);

      expect(cursors).toEqual([{ type: 'blockNumber', value: 3500000 }]);
    });
  });

  // ── applyReplayWindow ─────────────────────────────────────────────

  describe('applyReplayWindow', () => {
    it('should return blockNumber cursors unchanged (no replay window)', () => {
      const cursor = { type: 'blockNumber' as const, value: 3500000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should return timestamp cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1705312800000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  // ── getHealthCheckConfig ──────────────────────────────────────────

  describe('getHealthCheckConfig', () => {
    it('should target the account listing endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toContain('/account/latest/v1');
      expect(config.endpoint).toContain('network=finney');
    });

    it('should validate any response object with a data property as healthy', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ data: [] })).toBe(true);
      expect(validate({ data: null })).toBe(true);
    });

    it('should reject responses without a data property', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({})).toBe(false);
      expect(validate(null)).toBeFalsy();
      expect(validate(undefined)).toBeFalsy();
    });
  });
});
