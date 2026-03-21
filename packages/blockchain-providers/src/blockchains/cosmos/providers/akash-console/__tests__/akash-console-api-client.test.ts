/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
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
import type { CosmosTransaction } from '../../../types.js';
import { validateBech32Address } from '../../../utils.js';
import { AkashConsoleApiClient, akashConsoleMetadata } from '../akash-console.api-client.js';
import type {
  AkashBalanceResponse,
  AkashTransactionDetail,
  AkashTransactionListResponse,
} from '../akash-console.schemas.js';

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

vi.mock('../../../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils.js')>();
  return {
    ...actual,
    validateBech32Address: vi.fn(() => true),
  };
});

// ── Fixtures ────────────────────────────────────────────────────────

const TEST_ADDRESS = 'akash1testaddress0000000000000000000000000';
const OTHER_ADDRESS = 'akash1otheraddress000000000000000000000000';
const TX_HASH = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';

function buildListResponse(hashes: string[]): AkashTransactionListResponse {
  return {
    count: hashes.length,
    results: hashes.map((hash) => ({
      height: 18000000,
      datetime: '2024-01-15T10:00:00Z',
      hash,
      isSuccess: true,
      error: null,
      gasUsed: 150000,
      gasWanted: 200000,
      fee: 5000,
      memo: '',
      isSigner: true,
      messages: [{ id: 'msg-0', type: '/cosmos.bank.v1beta1.MsgSend', amount: 1000000, isReceiver: false }],
    })),
  };
}

function buildDetailResponse(hash: string, overrides?: Partial<AkashTransactionDetail>): AkashTransactionDetail {
  return {
    height: 18000000,
    datetime: '2024-01-15T10:00:00Z',
    hash,
    isSuccess: true,
    multisigThreshold: null,
    signers: [TEST_ADDRESS],
    error: null,
    gasUsed: 150000,
    gasWanted: 200000,
    fee: 5000,
    memo: '',
    messages: [
      {
        id: 'msg-0',
        type: '/cosmos.bank.v1beta1.MsgSend',
        data: {
          from_address: TEST_ADDRESS,
          to_address: OTHER_ADDRESS,
          amount: [{ denom: 'uakt', amount: '1000000' }],
        },
        relatedDeploymentId: null,
      },
    ],
    ...overrides,
  };
}

function buildBalanceResponse(available: number): AkashBalanceResponse {
  return {
    total: available,
    available,
    delegated: 0,
    rewards: 0,
    commission: 0,
    assets: [],
    delegations: [],
  };
}

// ── Test suite ───────────────────────────────────────────────────────

describe('AkashConsoleApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: AkashConsoleApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('akash', 'akash-console');
    client = new AkashConsoleApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(AkashConsoleApiClient);
      expect(client.blockchain).toBe('akash');
      expect(client.name).toBe('akash-console');
    });

    it('should not require API key', () => {
      expect(akashConsoleMetadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('blockNumber');
      expect(capabilities.replayWindow).toEqual({ blocks: 0 });
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return available balance (liquid funds only)', async () => {
      // 5000000 uakt = 5 AKT (6 decimals)
      mockGet.mockResolvedValue(ok(buildBalanceResponse(5000000)));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'AKT',
        rawAmount: '5000000',
        decimalAmount: '5',
        decimals: 6,
      });
      expect(mockGet).toHaveBeenCalledWith(
        `/addresses/${TEST_ADDRESS}`,
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should return zero balance when available is zero or negative', async () => {
      mockGet.mockResolvedValue(ok(buildBalanceResponse(0)));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
      expect(result.symbol).toBe('AKT');
    });

    it('should return error for invalid address without calling the API', async () => {
      vi.mocked(validateBech32Address).mockReturnValueOnce(false);

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'bad-address' }));

      expect(error.message).toContain('Invalid');
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Upstream error')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Upstream error');
    });
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unknown operation type', async () => {
      const error = expectErr(
        await client.execute({ type: 'getTokenMetadata', address: TEST_ADDRESS } as unknown as OneShotOperation)
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
      expect(expectErr(results[0]!).message).toContain('Streaming not yet implemented');
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
      expect(expectErr(results[0]!).message).toContain('Unsupported transaction type');
    });

    it('should fetch list then detail for each tx (N+1 pattern)', async () => {
      mockGet
        .mockResolvedValueOnce(ok(buildListResponse([TX_HASH]))) // list call
        .mockResolvedValueOnce(ok(buildDetailResponse(TX_HASH))); // detail call for TX_HASH

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe(TX_HASH);
      expect(transactions[0]!.providerName).toBe('akash-console');
      // 1 list + 1 detail = 2 API calls
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should use skip/limit path in list endpoint', async () => {
      mockGet
        .mockResolvedValueOnce(ok(buildListResponse([TX_HASH])))
        .mockResolvedValueOnce(ok(buildDetailResponse(TX_HASH)));

      for await (const _ of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        // consume all
      }

      const listCall = mockGet.mock.calls[0]![0] as string;
      expect(listCall).toMatch(/\/addresses\/.+\/transactions\/0\/\d+/);
    });

    it('should handle empty transaction list', async () => {
      mockGet.mockResolvedValueOnce(ok(buildListResponse([])));

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
      // Only the list call; no detail calls
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should paginate when list returns a full batch', async () => {
      const BATCH_SIZE = 20;
      const page1Hashes = Array.from({ length: BATCH_SIZE }, (_, i) => `TX${i.toString().padStart(63, '0')}`);
      const page2Hash = 'TXLAST'.padEnd(64, '0');

      // Page 1: full batch (signals more pages)
      mockGet.mockResolvedValueOnce(ok(buildListResponse(page1Hashes)));
      page1Hashes.forEach((hash) => mockGet.mockResolvedValueOnce(ok(buildDetailResponse(hash))));

      // Page 2: partial batch (signals end)
      mockGet.mockResolvedValueOnce(ok(buildListResponse([page2Hash])));
      mockGet.mockResolvedValueOnce(ok(buildDetailResponse(page2Hash)));

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(BATCH_SIZE + 1);
    });

    it('should advance skip offset on second page', async () => {
      const BATCH_SIZE = 20;
      const page1Hashes = Array.from({ length: BATCH_SIZE }, (_, i) => `TX${i.toString().padStart(63, '0')}`);

      mockGet.mockResolvedValueOnce(ok(buildListResponse(page1Hashes)));
      page1Hashes.forEach((hash) => mockGet.mockResolvedValueOnce(ok(buildDetailResponse(hash))));
      mockGet.mockResolvedValueOnce(ok(buildListResponse([])));

      for await (const _ of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        // consume all
      }

      // Find the second list call (after BATCH_SIZE detail calls)
      const secondListCallIndex = BATCH_SIZE + 1;
      const secondListUrl = mockGet.mock.calls[secondListCallIndex]![0] as string;
      expect(secondListUrl).toContain(`/transactions/${BATCH_SIZE}/`);
    });

    it('should propagate list endpoint API errors', async () => {
      mockGet.mockResolvedValueOnce(err(new Error('Bad gateway')));

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

    it('should propagate detail endpoint API errors', async () => {
      mockGet
        .mockResolvedValueOnce(ok(buildListResponse([TX_HASH])))
        .mockResolvedValueOnce(err(new Error('Not found')));

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
    it('should return blockNumber, txHash, and timestamp when all fields are present', () => {
      const cursors = client.extractCursors({
        id: TX_HASH,
        blockHeight: 18000000,
        timestamp: 1705312800000,
      } as CosmosTransaction);

      expect(cursors).toEqual([
        { type: 'blockNumber', value: 18000000 },
        { type: 'txHash', value: TX_HASH },
        { type: 'timestamp', value: 1705312800000 },
      ]);
    });

    it('should omit blockNumber when blockHeight is undefined', () => {
      const cursors = client.extractCursors({ id: TX_HASH, timestamp: 1705312800000 } as CosmosTransaction);

      expect(cursors).toEqual([
        { type: 'txHash', value: TX_HASH },
        { type: 'timestamp', value: 1705312800000 },
      ]);
    });

    it('should omit timestamp when falsy', () => {
      const cursors = client.extractCursors({ id: TX_HASH, blockHeight: 18000000, timestamp: 0 } as CosmosTransaction);

      expect(cursors).toEqual([
        { type: 'blockNumber', value: 18000000 },
        { type: 'txHash', value: TX_HASH },
      ]);
    });
  });

  describe('applyReplayWindow', () => {
    it('should pass through blockNumber cursors unchanged (no replay window)', () => {
      const cursor = { type: 'blockNumber' as const, value: 18000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through txHash cursors unchanged', () => {
      const cursor = { type: 'txHash' as const, value: TX_HASH };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through timestamp cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1705312800000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target the addresses endpoint with a test address', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toMatch(/\/addresses\/akash1/);
    });

    it('should validate any non-null object response as healthy', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ available: 0 })).toBe(true);
      expect(validate({})).toBe(true);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
      expect(validate('string')).toBe(false);
    });
  });
});
