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
import type { SolanaTransaction } from '../../../schemas.js';
import { SolscanApiClient, solscanMetadata } from '../solscan.api-client.js';
import type { SolscanTransaction } from '../solscan.schemas.js';

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

const TEST_ADDRESS = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
const RECEIVER_ADDRESS = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
const PROGRAM_ADDRESS = '11111111111111111111111111111111';
const TX_HASH = '5UfWrM37GgDTNB7SWzGK5PkuPkFdPg3JWBvdBrMZG1s9xCJZbAQz7NxQn4Pgb91dVBvnUCQ9Jw';

function buildBalanceResponse(lamports = '5000000000') {
  return { success: true, data: { lamports } };
}

function buildTransaction(overrides?: Partial<SolscanTransaction>): SolscanTransaction {
  return {
    blockTime: new Date('2023-11-14T22:13:20.000Z'), // 1700000000 * 1000ms
    fee: 5000,
    inputAccount: [
      { account: TEST_ADDRESS, preBalance: 10000000000, postBalance: 9994995000, signer: true, writable: true },
      { account: RECEIVER_ADDRESS, preBalance: 0, postBalance: 5000000, signer: false, writable: true },
    ],
    lamport: 5000000,
    logMessage: [],
    parsedInstruction: [{ params: {}, program: 'system', programId: PROGRAM_ADDRESS, type: 'transfer' }],
    recentBlockhash: 'BHnRy1tFhGbBEMiWaKFHfGvNLjRQHZ8Bxw7qMqFEkuH',
    signer: [TEST_ADDRESS],
    slot: 200000000,
    status: 'Success',
    txHash: TX_HASH,
    ...overrides,
  };
}

function buildTransactionsResponse(txs: SolscanTransaction[] = [buildTransaction()]) {
  return { success: true, data: txs };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('SolscanApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: SolscanApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    process.env['SOLSCAN_API_KEY'] = 'test-solscan-api-key';

    const config = providerRegistry.createDefaultConfig('solana', 'solscan');
    client = new SolscanApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(SolscanApiClient);
      expect(client.blockchain).toBe('solana');
      expect(client.name).toBe('solscan');
    });

    it('should require API key', () => {
      expect(solscanMetadata.requiresApiKey).toBe(true);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toEqual(['getAddressTransactions', 'getAddressBalances']);
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('pageToken');
    });

    it('should have conservative rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(1);
      expect(rateLimit.requestsPerMinute).toBe(60);
      expect(rateLimit.burstLimit).toBe(1);
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return SOL balance data from lamports string', async () => {
      mockGet.mockResolvedValue(ok(buildBalanceResponse('5000000000')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'SOL',
        rawAmount: '5000000000',
        decimalAmount: '5',
        decimals: 9,
      });
      expect(mockGet).toHaveBeenCalledWith(`/account/${TEST_ADDRESS}`, expect.anything());
    });

    it('should handle zero balance', async () => {
      mockGet.mockResolvedValue(ok(buildBalanceResponse('0')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should handle missing lamports as zero', async () => {
      mockGet.mockResolvedValue(ok({ success: true, data: {} }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.rawAmount).toBe('0');
    });

    it('should return error for invalid Solana address', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'not-valid' }));

      expect(error.message).toContain('Invalid Solana address');
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should return error when success is false', async () => {
      mockGet.mockResolvedValue(ok({ success: false, data: null }));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toContain('Failed to fetch balance from Solscan API');
    });

    it('should return error when data is missing', async () => {
      mockGet.mockResolvedValue(ok({ success: true, data: null }));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toContain('Failed to fetch balance from Solscan API');
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Network timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network timeout');
    });
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unknown operation type', async () => {
      const error = expectErr(
        await client.execute({
          address: TEST_ADDRESS,
          type: 'getTokenMetadata',
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

    it('should stream transactions via V2 endpoint', async () => {
      // Single tx → items.length (1) < limit (100) → complete
      mockGet.mockResolvedValueOnce(ok(buildTransactionsResponse([buildTransaction()])));

      const transactions: SolanaTransaction[] = [];
      for await (const result of client.executeStreaming<SolanaTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe(TX_HASH);
      expect(transactions[0]!.providerName).toBe('solscan');
      expect(transactions[0]!.status).toBe('success');
    });

    it('should fall back to V1 endpoint when V2 fails', async () => {
      // V2 fails
      mockGet.mockResolvedValueOnce(err(new Error('401 Unauthorized')));
      // V1 succeeds
      mockGet.mockResolvedValueOnce(ok(buildTransactionsResponse([buildTransaction()])));

      const transactions: SolanaTransaction[] = [];
      for await (const result of client.executeStreaming<SolanaTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe(TX_HASH);
    });

    it('should propagate error when both V2 and V1 fail', async () => {
      mockGet.mockResolvedValueOnce(err(new Error('V2 failed')));
      mockGet.mockResolvedValueOnce(err(new Error('V1 failed')));

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

    it('should map failed transaction status correctly', async () => {
      mockGet.mockResolvedValueOnce(ok(buildTransactionsResponse([buildTransaction({ status: 'Fail' })])));

      const transactions: SolanaTransaction[] = [];
      for await (const result of client.executeStreaming<SolanaTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions[0]!.status).toBe('failed');
    });

    it('should handle empty transaction list', async () => {
      mockGet.mockResolvedValueOnce(ok(buildTransactionsResponse([])));
      // V1 fallback also empty
      mockGet.mockResolvedValueOnce(ok(buildTransactionsResponse([])));

      const batches = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        batches.push(result);
      }

      expect(batches).toHaveLength(1);
      const batch = expectOk(batches[0]!);
      expect(batch.data).toHaveLength(0);
    });
  });

  describe('extractCursors', () => {
    it('should extract timestamp and blockNumber cursors', () => {
      const cursors = client.extractCursors({
        timestamp: 1700000000000,
        blockHeight: 200000000,
      } as SolanaTransaction);

      expect(cursors).toEqual([
        { type: 'timestamp', value: 1700000000000 },
        { type: 'blockNumber', value: 200000000 },
      ]);
    });

    it('should omit blockNumber when blockHeight is undefined', () => {
      const cursors = client.extractCursors({
        timestamp: 1700000000000,
      } as SolanaTransaction);

      expect(cursors).toEqual([{ type: 'timestamp', value: 1700000000000 }]);
    });

    it('should omit timestamp when not present', () => {
      const cursors = client.extractCursors({
        blockHeight: 200000000,
      } as SolanaTransaction);

      expect(cursors).toEqual([{ type: 'blockNumber', value: 200000000 }]);
    });

    it('should return empty array when no cursor fields', () => {
      const cursors = client.extractCursors({} as SolanaTransaction);
      expect(cursors).toEqual([]);
    });

    it('should NOT include pageToken cursor (offset-based pagination)', () => {
      const cursors = client.extractCursors({
        id: TX_HASH,
        timestamp: 1700000000000,
        blockHeight: 200000000,
      } as SolanaTransaction);

      const types = cursors.map((c) => c.type);
      expect(types).not.toContain('pageToken');
    });
  });

  describe('applyReplayWindow', () => {
    it('should pass through all cursor types unchanged (offset-based, no replay)', () => {
      const blockCursor = { type: 'blockNumber' as const, value: 200000000 };
      expect(client.applyReplayWindow(blockCursor)).toEqual(blockCursor);

      const tsCursor = { type: 'timestamp' as const, value: 1700000000000 };
      expect(client.applyReplayWindow(tsCursor)).toEqual(tsCursor);

      const tokenCursor = { type: 'pageToken' as const, value: '100', providerName: 'solscan' };
      expect(client.applyReplayWindow(tokenCursor)).toEqual(tokenCursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target USDC account endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toContain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('should validate successful response', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ success: true })).toBe(true);
      expect(validate({ success: true, data: {} })).toBe(true);
    });

    it('should reject failed responses', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ success: false })).toBeFalsy();
      expect(validate(null)).toBeFalsy();
      expect(validate(undefined)).toBeFalsy();
    });
  });
});
