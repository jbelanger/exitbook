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
import { InjectiveExplorerApiClient, injectiveExplorerMetadata } from '../injective-explorer.api-client.js';
import type {
  InjectiveApiResponse,
  InjectiveBalanceResponse,
  InjectiveTransaction,
} from '../injective-explorer.schemas.js';

// ── Module-level mocks (hoisted by vitest) ──────────────────────────

// Injective uses two HTTP clients:
//   - httpClient (BaseApiClient) from @exitbook/shared-utils → for explorer API (streaming)
//   - restClient (InjectiveExplorerApiClient) from @exitbook/http  → for bank balance queries
//
// Strategy: mock @exitbook/shared-utils so BaseApiClient gets mockExplorerHttp.
// For restClient, let the real @exitbook/http HttpClient be constructed, then replace
// it with mockRestHttp via Object.defineProperty in beforeEach.
const mockExplorerHttp = createMockHttpClient();
const mockRestHttp = createMockHttpClient();

vi.mock('@exitbook/shared-utils', () => ({
  HttpClient: vi.fn(() => mockExplorerHttp),
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

const TEST_ADDRESS = 'inj1testaddress000000000000000000000000000';
const OTHER_ADDRESS = 'inj1otheraddress00000000000000000000000000';
const TX_HASH = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';

function buildInjectiveTx(overrides?: Partial<InjectiveTransaction>): InjectiveTransaction {
  return {
    block_number: 18000000,
    block_timestamp: new Date('2024-01-15T10:00:00Z'),
    code: 0,
    gas_fee: {
      amount: [{ amount: '100000000000000000', denom: 'inj' }],
      gas_limit: 200000,
      granter: null,
      payer: null,
    },
    gas_used: 150000,
    gas_wanted: 200000,
    hash: TX_HASH,
    messages: [
      {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          from_address: TEST_ADDRESS,
          to_address: OTHER_ADDRESS,
          amount: [{ amount: '1000000000000000000', denom: 'inj' }],
        },
      },
    ],
    tx_type: '/cosmos.bank.v1beta1.MsgSend',
    ...overrides,
  } as InjectiveTransaction;
}

function buildApiResponse(txs: InjectiveTransaction[], total = txs.length): InjectiveApiResponse {
  return {
    data: txs,
    paging: { total, from: 0, to: txs.length },
  };
}

function buildBalanceResponse(amount: string, denom = 'inj'): InjectiveBalanceResponse {
  return {
    balances: [{ denom, amount }],
    pagination: { next_key: null, total: '1' },
  };
}

// ── Test suite ───────────────────────────────────────────────────────

describe('InjectiveExplorerApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: InjectiveExplorerApiClient;
  let mockExplorerGet: MockHttpClient['get'];
  let mockRestGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockExplorerHttp);
    resetMockHttpClient(mockRestHttp);

    const config = providerRegistry.createDefaultConfig('injective', 'injective-explorer');
    client = new InjectiveExplorerApiClient(config);

    // Inject explorer HTTP client (used for streaming)
    injectMockHttpClient(client, mockExplorerHttp);
    // Inject REST HTTP client (used for balance queries)
    Object.defineProperty(client, 'restClient', {
      configurable: true,
      value: mockRestHttp,
      writable: true,
    });

    mockExplorerGet = mockExplorerHttp.get;
    mockRestGet = mockRestHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(InjectiveExplorerApiClient);
      expect(client.blockchain).toBe('injective');
      expect(client.name).toBe('injective-explorer');
    });

    it('should not require API key', () => {
      expect(injectiveExplorerMetadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('blockNumber');
      expect(capabilities.replayWindow).toEqual({ blocks: 2 });
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return balance when native currency is found', async () => {
      // Injective uses nativeCurrency ('INJ') not nativeDenom ('inj') to match balance denom
      mockRestGet.mockResolvedValue(ok(buildBalanceResponse('5000000000000000000', 'INJ')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.symbol).toBe('INJ');
      expect(result.decimals).toBe(18);
      expect(mockRestGet).toHaveBeenCalledWith(
        `/cosmos/bank/v1beta1/balances/${TEST_ADDRESS}`,
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should return zero balance when balances array is empty', async () => {
      mockRestGet.mockResolvedValue(ok({ balances: [], pagination: { next_key: null, total: '0' } }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.symbol).toBe('INJ');
    });

    it('should return zero balance when native currency is absent', async () => {
      mockRestGet.mockResolvedValue(ok(buildBalanceResponse('5000000', 'ibc/1234')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
    });

    it('should return error for invalid address without calling the API', async () => {
      vi.mocked(validateBech32Address).mockReturnValueOnce(false);

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'bad-address' }));

      expect(error.message).toContain('Invalid');
      expect(mockRestGet).not.toHaveBeenCalled();
    });

    it('should propagate API errors', async () => {
      mockRestGet.mockResolvedValue(err(new Error('Service unavailable')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Service unavailable');
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

    it('should stream transactions using skip/limit pagination', async () => {
      mockExplorerGet.mockResolvedValueOnce(ok(buildApiResponse([buildInjectiveTx()])));

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
      expect(transactions[0]!.providerName).toBe('injective-explorer');
      expect(mockExplorerGet).toHaveBeenCalledWith(
        expect.stringContaining(`/api/explorer/v1/accountTxs/${TEST_ADDRESS}`),
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should handle empty transaction list', async () => {
      mockExplorerGet.mockResolvedValueOnce(ok(buildApiResponse([])));

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(0);
    });

    it('should paginate until fewer than batch size results are returned', async () => {
      // Batch size is 50; return 50 items on page 1, then fewer on page 2
      const fullPage = Array.from({ length: 50 }, (_, i) =>
        buildInjectiveTx({ hash: `TX${i.toString().padStart(62, '0')}` })
      );
      const lastPage = [buildInjectiveTx({ hash: 'TXLAST'.padEnd(64, '0') })];

      mockExplorerGet
        .mockResolvedValueOnce(ok(buildApiResponse(fullPage, 51)))
        .mockResolvedValueOnce(ok(buildApiResponse(lastPage, 51)));

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions.length).toBeGreaterThan(50);
      expect(mockExplorerGet).toHaveBeenCalledTimes(2);
    });

    it('should include skip offset in second page request', async () => {
      const fullPage = Array.from({ length: 50 }, (_, i) =>
        buildInjectiveTx({ hash: `TX${i.toString().padStart(62, '0')}` })
      );

      mockExplorerGet
        .mockResolvedValueOnce(ok(buildApiResponse(fullPage, 51)))
        .mockResolvedValueOnce(ok(buildApiResponse([])));

      for await (const _ of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        // consume all
      }

      const secondCall = mockExplorerGet.mock.calls[1]![0] as string;
      expect(secondCall).toContain('skip=50');
    });

    it('should propagate API errors during streaming', async () => {
      mockExplorerGet.mockResolvedValue(err(new Error('Gateway timeout')));

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
    it('should subtract 2 replay blocks from blockNumber cursor', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 100000 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 99998 });
    });

    it('should not go below zero', () => {
      const cursor = client.applyReplayWindow({ type: 'blockNumber', value: 1 });
      expect(cursor).toEqual({ type: 'blockNumber', value: 0 });
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
    it('should target the accountTxs endpoint with a test address', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toContain('/api/explorer/v1/accountTxs/');
      expect(config.endpoint).toContain('inj1');
    });

    it('should validate any non-null object response as healthy', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ data: [] })).toBe(true);
      expect(validate({})).toBe(true);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
      expect(validate('string')).toBe(false);
    });
  });
});
