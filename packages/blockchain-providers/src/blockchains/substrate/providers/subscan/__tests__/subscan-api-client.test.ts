/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
/* eslint-disable unicorn/no-null -- acceptable for tests */
import { err, ok } from '@exitbook/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  type MockHttpClient,
  resetMockHttpClient,
} from '../../../__tests__/test-utils.js';
import type { OneShotOperation } from '../../../../../core/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { SubstrateTransaction } from '../../../types.js';
import { SubscanApiClient, subscanMetadata } from '../subscan.api-client.js';
import type { SubscanAccountResponse, SubscanTransfer, SubscanTransfersResponse } from '../subscan.schemas.js';

// ── Module-level mocks (hoisted by vitest) ──────────────────────────

const mockHttp = createMockHttpClient();
const httpClientConfigs: Record<string, unknown>[] = [];

vi.mock('@exitbook/http', () => ({
  HttpClient: vi.fn(function HttpClientMock(config: Record<string, unknown>) {
    httpClientConfigs.push(config);
    return mockHttp;
  }),
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

// Alice and Bob — well-known generic-SS58 (format 42) test accounts
const TEST_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const OTHER_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const TX_HASH = '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1';

function buildAccountResponse(balance = '10000000000'): SubscanAccountResponse {
  return { code: 0, message: 'success', data: { balance } };
}

function buildTransfer(overrides?: Partial<SubscanTransfer>): SubscanTransfer {
  return {
    amount: '1',
    block_num: 18000000,
    block_timestamp: new Date('2024-01-15T10:00:00Z'),
    event_idx: 0,
    extrinsic_index: '18000000-2',
    fee: '15000000000',
    from: TEST_ADDRESS,
    hash: TX_HASH,
    module: 'balances',
    success: true,
    to: OTHER_ADDRESS,
    ...overrides,
  };
}

function buildTransfersResponse(transfers: SubscanTransfer[] = [buildTransfer()]): SubscanTransfersResponse {
  return { code: 0, message: 'success', data: { transfers } };
}

// ── Test suite ────────────────────────────────────────────────────────

describe('SubscanApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: SubscanApiClient;
  let mockPost: MockHttpClient['post'];
  const originalSubscanApiKey = process.env['SUBSCAN_API_KEY'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);
    mockHttp.close.mockResolvedValue(undefined);
    httpClientConfigs.length = 0;
    process.env['SUBSCAN_API_KEY'] = 'test-subscan-api-key';

    client = new SubscanApiClient(providerRegistry.createDefaultConfig('polkadot', 'subscan'));
    injectMockHttpClient(client, mockHttp);
    mockPost = mockHttp.post;
  });

  afterAll(() => {
    if (originalSubscanApiKey === undefined) {
      delete process.env['SUBSCAN_API_KEY'];
      return;
    }

    process.env['SUBSCAN_API_KEY'] = originalSubscanApiKey;
  });

  // ── metadata ─────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(SubscanApiClient);
      expect(client.blockchain).toBe('polkadot');
      expect(client.name).toBe('subscan');
    });

    it('should require an API key', () => {
      expect(subscanMetadata.requiresApiKey).toBe(true);
    });

    it('should configure X-API-Key header for authenticated requests', () => {
      const config = httpClientConfigs.at(-1);

      expect(config).toBeDefined();
      expect(config).toEqual(
        expect.objectContaining({
          baseUrl: 'https://polkadot.api.subscan.io',
          defaultHeaders: expect.objectContaining({
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-API-Key': 'test-subscan-api-key',
          }),
        })
      );
    });

    it('should support getAddressTransactions and getAddressBalances', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
    });

    it('should prefer pageToken cursor', () => {
      expect(client.capabilities.preferredCursorType).toBe('pageToken');
    });
  });

  // ── execute: getAddressBalances ───────────────────────────────────

  describe('execute - getAddressBalances', () => {
    it('should return converted balance when API responds successfully', async () => {
      // 10 DOT = 10_000_000_000 planck (10 decimals)
      mockPost.mockResolvedValue(ok(buildAccountResponse('100000000000')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.symbol).toBe('DOT');
      expect(result.rawAmount).toBe('100000000000');
      expect(result.decimalAmount).toBe('10');
      expect(result.decimals).toBe(10);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/scan/account',
        { key: TEST_ADDRESS },
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should return zero balance when data is absent', async () => {
      mockPost.mockResolvedValue(ok({ code: 0, data: null }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('0');
      expect(result.decimalAmount).toBe('0');
    });

    it('should return error for invalid address without calling the API', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'not-an-ss58-address' }));

      expect(error.message).toContain('Invalid SS58 address');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should return error when API code is non-zero', async () => {
      mockPost.mockResolvedValue(ok({ code: 10004, message: 'Record Not Found' }));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toContain('Subscan API error');
      expect(error.message).toContain('Record Not Found');
    });

    it('should propagate HTTP errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Connection timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Connection timeout');
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

    it('should stream transfers and map them to SubstrateTransactions', async () => {
      mockPost.mockResolvedValue(ok(buildTransfersResponse([buildTransfer()])));

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
      expect(transactions[0]!.providerName).toBe('subscan');
      expect(transactions[0]!.status).toBe('success');
      // amount: 1 DOT × 10^10 planck
      expect(transactions[0]!.amount).toBe('10000000000');
    });

    it('should paginate across multiple pages until transfers < 100', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) =>
        buildTransfer({ hash: `0x${i.toString().padStart(64, '0')}`, event_idx: i })
      );
      const page2 = [buildTransfer({ hash: '0x' + 'f'.repeat(64), event_idx: 200 })];

      mockPost
        .mockResolvedValueOnce(ok(buildTransfersResponse(page1)))
        .mockResolvedValueOnce(ok(buildTransfersResponse(page2)));

      const transactions: SubstrateTransaction[] = [];
      for await (const result of client.executeStreaming<SubstrateTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(101);
      expect(mockPost).toHaveBeenCalledTimes(2);
      // First call uses page 0, second uses page 1
      expect(mockPost).toHaveBeenNthCalledWith(
        1,
        '/api/v2/scan/transfers',
        expect.objectContaining({ address: TEST_ADDRESS, page: 0, row: 100 }),
        expect.anything()
      );
      expect(mockPost).toHaveBeenNthCalledWith(
        2,
        '/api/v2/scan/transfers',
        expect.objectContaining({ page: 1 }),
        expect.anything()
      );
    });

    it('should complete immediately when transfers list is empty', async () => {
      mockPost.mockResolvedValue(ok(buildTransfersResponse([])));

      const transactions: SubstrateTransaction[] = [];
      for await (const result of client.executeStreaming<SubstrateTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        transactions.push(...expectOk(result).data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('should propagate streaming API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Rate limited')));

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

    it('should return error when streaming response code is non-zero', async () => {
      mockPost.mockResolvedValue(ok({ code: 10004, message: 'Invalid Page', data: null }));

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

    it('should silently skip transfers not relevant to the requested address', async () => {
      // fetchPage pre-filters irrelevant transfers before passing them to mapItem,
      // so an unrelated transfer produces an empty batch rather than an error.
      const irrelevant = buildTransfer({ from: OTHER_ADDRESS, to: '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy' });
      mockPost.mockResolvedValue(ok(buildTransfersResponse([irrelevant])));

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
    it('should return timestamp and blockNumber cursors', () => {
      const tx = { timestamp: 1705312800000, blockHeight: 18000000 } as SubstrateTransaction;
      const cursors = client.extractCursors(tx);

      expect(cursors).toEqual([
        { type: 'timestamp', value: 1705312800000 },
        { type: 'blockNumber', value: 18000000 },
      ]);
    });

    it('should omit blockNumber cursor when blockHeight is undefined', () => {
      const cursors = client.extractCursors({ timestamp: 1705312800000 } as SubstrateTransaction);

      expect(cursors).toEqual([{ type: 'timestamp', value: 1705312800000 }]);
    });

    it('should omit timestamp cursor when timestamp is falsy', () => {
      const cursors = client.extractCursors({ timestamp: 0, blockHeight: 18000000 } as SubstrateTransaction);

      expect(cursors).toEqual([{ type: 'blockNumber', value: 18000000 }]);
    });
  });

  // ── applyReplayWindow ─────────────────────────────────────────────

  describe('applyReplayWindow', () => {
    it('should return pageToken cursors unchanged', () => {
      const cursor = { type: 'pageToken' as const, value: '5', providerName: 'subscan' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should return timestamp cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1705312800000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should return blockNumber cursors unchanged', () => {
      const cursor = { type: 'blockNumber' as const, value: 18000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  // ── getHealthCheckConfig ──────────────────────────────────────────

  describe('getHealthCheckConfig', () => {
    it('should target the metadata endpoint with POST', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/api/scan/metadata');
      expect(config.method).toBe('POST');
    });

    it('should validate a response with code 0 as healthy', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ code: 0 })).toBe(true);
    });

    it('should reject a response with non-zero code', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ code: 10004 })).toBe(false);
    });

    it('should reject null and undefined responses', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate(null)).toBeFalsy();
      expect(validate(undefined)).toBeFalsy();
    });
  });
});
