/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
/* eslint-disable unicorn/no-null -- acceptable for tests */
import { err, ok } from '@exitbook/foundation';
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
import { CosmosRestApiClient, cosmosRestFactories } from '../cosmos-rest.api-client.js';
import type { CosmosBalanceResponse, CosmosRestApiResponse, CosmosTxResponse } from '../cosmos-rest.schemas.js';

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

// Partial mock: override only validateBech32Address; preserve real util functions
// (isTransactionRelevant, formatDenom, etc.) used by the mapper during streaming.
vi.mock('../../../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils.js')>();
  return {
    ...actual,
    validateBech32Address: vi.fn(() => true),
  };
});

// ── Fixtures ────────────────────────────────────────────────────────

// Any string works here: validateBech32Address is mocked and mapper does string comparison only
const TEST_ADDRESS = 'cosmos1testaddress000000000000000000000000';
const OTHER_ADDRESS = 'cosmos1otheraddress00000000000000000000000';
const TX_HASH = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';

function buildTxResponse(overrides?: Partial<CosmosTxResponse>): CosmosTxResponse {
  return {
    height: '18000000',
    txhash: TX_HASH,
    timestamp: '2024-01-15T10:00:00Z',
    code: 0,
    gas_wanted: '200000',
    gas_used: '150000',
    tx: {
      body: {
        messages: [
          {
            '@type': '/cosmos.bank.v1beta1.MsgSend',
            from_address: TEST_ADDRESS,
            to_address: OTHER_ADDRESS,
            amount: [{ denom: 'uatom', amount: '1000000' }],
          },
        ],
      },
      auth_info: {
        fee: {
          amount: [{ denom: 'uatom', amount: '5000' }],
          gas_limit: '200000',
        },
        signer_infos: [],
      },
      signatures: ['sig'],
    },
    ...overrides,
  };
}

function buildRewardTxResponse(overrides?: Partial<CosmosTxResponse>): CosmosTxResponse {
  return buildTxResponse({
    txhash: 'REWARD1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
    tx: {
      body: {
        messages: [
          {
            '@type': '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
            delegator_address: TEST_ADDRESS,
            validator_address: 'cosmosvaloper1validator0000000000000000000000',
          },
        ],
      },
      auth_info: {
        fee: {
          amount: [{ denom: 'uatom', amount: '6800' }],
          gas_limit: '200000',
        },
        signer_infos: [],
      },
      signatures: ['sig'],
    },
    events: [
      {
        type: 'withdraw_rewards',
        attributes: [
          { key: 'amount', value: '5ibc/ABCDEF,67732uatom' },
          { key: 'validator', value: 'cosmosvaloper1validator0000000000000000000000' },
          { key: 'delegator', value: TEST_ADDRESS },
          { key: 'msg_index', value: '0' },
        ],
      },
    ],
    ...overrides,
  });
}

function buildUndelegateTxResponse(overrides?: Partial<CosmosTxResponse>): CosmosTxResponse {
  return buildTxResponse({
    txhash: 'UNDELEGATE234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456',
    tx: {
      body: {
        messages: [
          {
            '@type': '/cosmos.staking.v1beta1.MsgUndelegate',
            delegator_address: TEST_ADDRESS,
            validator_address: 'cosmosvaloper1validator0000000000000000000000',
            amount: { denom: 'uatom', amount: '300000' },
          },
        ],
      },
      auth_info: {
        fee: {
          amount: [{ denom: 'uatom', amount: '5070' }],
          gas_limit: '200000',
        },
        signer_infos: [],
      },
      signatures: ['sig'],
    },
    events: [
      {
        type: 'withdraw_rewards',
        attributes: [
          { key: 'amount', value: '11uatom' },
          { key: 'validator', value: 'cosmosvaloper1validator0000000000000000000000' },
          { key: 'delegator', value: TEST_ADDRESS },
          { key: 'msg_index', value: '0' },
        ],
      },
      {
        type: 'unbond',
        attributes: [
          { key: 'amount', value: '300000uatom' },
          { key: 'validator', value: 'cosmosvaloper1validator0000000000000000000000' },
          { key: 'delegator', value: TEST_ADDRESS },
          { key: 'msg_index', value: '0' },
        ],
      },
    ],
    ...overrides,
  });
}

function buildApiResponse(txResponses: CosmosTxResponse[], nextKey?: string): CosmosRestApiResponse {
  return {
    tx_responses: txResponses,
    txs: [],
    pagination: { next_key: nextKey ?? null },
  };
}

const ACCOUNT_EVENT_SEARCH_QUERY_BY_INDEX = [
  `message.sender='${TEST_ADDRESS}'`,
  `coin_spent.spender='${TEST_ADDRESS}'`,
  `coin_received.receiver='${TEST_ADDRESS}'`,
  `transfer.sender='${TEST_ADDRESS}'`,
  `transfer.recipient='${TEST_ADDRESS}'`,
  `withdraw_rewards.delegator='${TEST_ADDRESS}'`,
  `delegate.delegator='${TEST_ADDRESS}'`,
  `unbond.delegator='${TEST_ADDRESS}'`,
  `redelegate.delegator='${TEST_ADDRESS}'`,
] as const;

function mockAccountEventSearchResponses(responsesByIndex: Partial<Record<number, CosmosRestApiResponse>> = {}): void {
  for (const index of ACCOUNT_EVENT_SEARCH_QUERY_BY_INDEX.keys()) {
    mockHttp.get.mockResolvedValueOnce(ok(responsesByIndex[index] ?? buildApiResponse([])));
  }
}

function buildBalanceResponse(amount: string, denom = 'uatom'): CosmosBalanceResponse {
  return {
    balances: [{ denom, amount }],
    pagination: { next_key: null },
  };
}

// ── Test suite ───────────────────────────────────────────────────────

describe('CosmosRestApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: CosmosRestApiClient;
  let mockGet: MockHttpClient['get'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = {
      ...providerRegistry.createDefaultConfig('cosmoshub', 'cosmos-rest'),
      chainName: 'cosmoshub',
    };
    client = new CosmosRestApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockGet = mockHttp.get;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(CosmosRestApiClient);
      expect(client.blockchain).toBe('cosmoshub');
      expect(client.name).toBe('cosmos-rest');
    });

    it('should not require API key', () => {
      const factory = cosmosRestFactories.find((f) => f.metadata.blockchain === 'cosmoshub');
      expect(factory?.metadata.requiresApiKey).toBe(false);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
      expect(capabilities.supportedTransactionTypes).toEqual(['normal']);
      expect(capabilities.preferredCursorType).toBe('pageToken');
      expect(capabilities.replayWindow).toEqual({ blocks: 0 });
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return balance when native denom is found', async () => {
      mockGet.mockResolvedValue(ok(buildBalanceResponse('5000000', 'uatom')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'ATOM',
        rawAmount: '5000000',
        decimalAmount: '5',
        decimals: 6,
      });
      expect(mockGet).toHaveBeenCalledWith(
        `/cosmos/bank/v1beta1/balances/${TEST_ADDRESS}`,
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('should return zero balance when balances array is empty', async () => {
      mockGet.mockResolvedValue(ok({ balances: [], pagination: null }));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
      expect(result.symbol).toBe('ATOM');
    });

    it('should return zero balance when native denom is absent', async () => {
      mockGet.mockResolvedValue(ok(buildBalanceResponse('5000000', 'ibc/1234')));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
    });

    it('should return error for invalid address without calling the API', async () => {
      vi.mocked(validateBech32Address).mockReturnValueOnce(false);

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'bad-address' }));

      expect(error.message).toContain('Invalid');
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should propagate API errors', async () => {
      mockGet.mockResolvedValue(err(new Error('Connection refused')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Connection refused');
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

    it('should stream transactions through account event searches', async () => {
      mockAccountEventSearchResponses({
        1: buildApiResponse([buildTxResponse()]),
      });

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
      expect(transactions[0]!.providerName).toBe('cosmos-rest');
      expect(mockGet).toHaveBeenCalledTimes(ACCOUNT_EVENT_SEARCH_QUERY_BY_INDEX.length);
      for (const [index, expectedQuery] of ACCOUNT_EVENT_SEARCH_QUERY_BY_INDEX.entries()) {
        const params = new URLSearchParams(String(mockGet.mock.calls[index]?.[0]).split('?')[1]);
        expect(params.get('query')).toBe(expectedQuery);
      }
    });

    it('normalizes staking reward withdrawals from withdraw_rewards events', async () => {
      mockAccountEventSearchResponses({
        5: buildApiResponse([buildRewardTxResponse()]),
      });

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        amount: '0.067732',
        currency: 'ATOM',
        from: 'cosmosvaloper1validator0000000000000000000000',
        messageType: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
        to: TEST_ADDRESS,
        txType: 'staking_reward',
      });
    });

    it('keeps staking operations with reward components importable', async () => {
      mockAccountEventSearchResponses({
        0: buildApiResponse([buildUndelegateTxResponse()]),
      });

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        amount: '0.000011',
        currency: 'ATOM',
        from: 'cosmosvaloper1validator0000000000000000000000',
        messageType: '/cosmos.staking.v1beta1.MsgUndelegate',
        to: TEST_ADDRESS,
        txType: 'staking_undelegate',
      });
    });

    it('should deduplicate transactions that appear in both sender and recipient results', async () => {
      const tx = buildTxResponse();
      mockAccountEventSearchResponses({
        1: buildApiResponse([tx]),
        2: buildApiResponse([tx]),
      });

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
    });

    it('should handle empty transaction list', async () => {
      mockAccountEventSearchResponses();

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

    it('should propagate account event search API errors', async () => {
      mockGet.mockResolvedValueOnce(err(new Error('Rate limited')));

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

    it('should propagate later account event search API errors', async () => {
      mockGet.mockResolvedValueOnce(ok(buildApiResponse([]))).mockResolvedValueOnce(err(new Error('Network timeout')));

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

    it('should paginate when next_key is present in an account event search response', async () => {
      const tx1 = buildTxResponse({
        txhash: 'TX1111111111111111111111111111111111111111111111111111111111111111',
        height: '200',
      });
      const tx2 = buildTxResponse({
        txhash: 'TX2222222222222222222222222222222222222222222222222222222222222222',
        height: '100',
      });

      mockGet.mockResolvedValueOnce(ok(buildApiResponse([tx1], 'next-page-token')));
      for (let index = 1; index < ACCOUNT_EVENT_SEARCH_QUERY_BY_INDEX.length; index += 1) {
        mockGet.mockResolvedValueOnce(ok(buildApiResponse([])));
      }
      mockGet.mockResolvedValueOnce(ok(buildApiResponse([tx2])));

      const transactions: CosmosTransaction[] = [];
      for await (const result of client.executeStreaming<CosmosTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledTimes(ACCOUNT_EVENT_SEARCH_QUERY_BY_INDEX.length + 1);
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
    it('should target the node_info endpoint', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/cosmos/base/tendermint/v1beta1/node_info');
    });

    it('should validate any non-null object response as healthy', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ node_info: {} })).toBe(true);
      expect(validate({})).toBe(true);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
      expect(validate('string')).toBe(false);
      expect(validate(42)).toBe(false);
    });
  });
});
