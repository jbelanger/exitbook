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
import { HeliusApiClient, heliusMetadata } from '../helius.api-client.js';
import type { HeliusTransaction } from '../helius.schemas.js';

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
const TOKEN_ACCOUNT = 'TokenAcct111111111111111111111111111111111111';
const MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const STAKE_ACCOUNT = 'StakeAcct1111111111111111111111111111111111';
const SIGNATURE = '5UfWrM37GgDTNB7SWzGK5PkuPkFdPg3JWBvdBrMZG1s9xCJZbAQz7NxQn4Pgb91dVBvnUCQ9Jw';

function buildBalanceResponse(lamports = 5000000000) {
  return { jsonrpc: '2.0', id: 1, result: { value: lamports } };
}

function buildTokenAccountsResponse() {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      value: [
        {
          pubkey: TOKEN_ACCOUNT,
          account: {
            data: {
              parsed: {
                info: {
                  mint: MINT_ADDRESS,
                  owner: TEST_ADDRESS,
                  tokenAmount: {
                    amount: '1000000',
                    decimals: 6,
                    uiAmount: 1.0,
                    uiAmountString: '1.0',
                  },
                },
                type: 'account',
              },
              program: 'spl-token',
              space: 165,
            },
            executable: false,
            lamports: 2039280,
            owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            rentEpoch: 361,
          },
        },
      ],
    },
  };
}

function buildSignaturesResponse(signatures: { signature: string; slot: number }[] = []) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: signatures,
  };
}

function buildHeliusTransaction(overrides?: Partial<HeliusTransaction>): HeliusTransaction {
  return {
    blockTime: new Date(1700000000 * 1000),
    err: null,
    meta: {
      err: null,
      fee: 5000,
      logMessages: [],
      postBalances: [9994995000, 5000000, 1000000000],
      postTokenBalances: null,
      preBalances: [10000000000, 0, 1000000000],
      preTokenBalances: null,
    },
    signature: null,
    slot: 200000000,
    transaction: {
      message: {
        accountKeys: [TEST_ADDRESS, RECEIVER_ADDRESS, PROGRAM_ADDRESS],
        instructions: [{ programIdIndex: 2, accounts: [0, 1], data: '3Bxs4h5', stackHeight: null }],
        recentBlockhash: 'BHnRy1tFhGbBEMiWaKFHfGvNLjRQHZ8Bxw7qMqFEkuH',
      },
      signatures: [SIGNATURE],
    },
    version: null,
    ...overrides,
  };
}

function buildAssetResponse(overrides?: object) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: {
        metadata: { name: 'USD Coin', symbol: 'USDC' },
        links: { image: 'https://example.com/usdc.png' },
      },
      token_info: { decimals: 6, supply: 1000000000 },
      ...overrides,
    },
  };
}

function buildStakeProgramAccountsResponse(accounts = [buildStakeProgramAccount()]) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: accounts,
  };
}

function buildStakeProgramAccount(overrides?: { lamports?: number | undefined; pubkey?: string | undefined }) {
  return {
    pubkey: overrides?.pubkey ?? STAKE_ACCOUNT,
    account: {
      data: { parsed: { type: 'delegated' } },
      executable: false,
      lamports: overrides?.lamports ?? 2500000000,
      owner: 'Stake11111111111111111111111111111111111111',
      rentEpoch: 361,
    },
  };
}

function buildStakeActivationResponse(state: 'active' | 'activating' | 'deactivating' | 'inactive' = 'active') {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      active: 2500000000,
      inactive: 0,
      state,
    },
  };
}

// ── Test suite ──────────────────────────────────────────────────────

describe('HeliusApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: HeliusApiClient;
  let mockPost: MockHttpClient['post'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    process.env['HELIUS_API_KEY'] = 'test-helius-api-key';

    const config = providerRegistry.createDefaultConfig('solana', 'helius');
    client = new HeliusApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockPost = mockHttp.post;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(HeliusApiClient);
      expect(client.blockchain).toBe('solana');
      expect(client.name).toBe('helius');
    });

    it('should require API key', () => {
      expect(heliusMetadata.requiresApiKey).toBe(true);
    });

    it('should have correct capabilities', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toEqual([
        'getAddressTransactions',
        'getAddressBalances',
        'getAddressStakingBalances',
        'getAddressTokenBalances',
        'getTokenMetadata',
      ]);
      expect(capabilities.supportedTransactionTypes).toEqual(['normal', 'stake', 'token']);
      expect(capabilities.preferredCursorType).toBe('pageToken');
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(5);
      expect(rateLimit.burstLimit).toBe(10);
      expect(rateLimit.requestsPerMinute).toBe(500);
      expect(rateLimit.requestsPerHour).toBe(5000);
    });
  });

  describe('execute - getAddressBalances', () => {
    it('should return SOL balance data from lamports', async () => {
      mockPost.mockResolvedValue(ok(buildBalanceResponse(5000000000)));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result).toEqual({
        symbol: 'SOL',
        rawAmount: '5000000000',
        decimalAmount: '5',
        decimals: 9,
        balanceCategory: 'liquid',
      });
      expect(mockPost).toHaveBeenCalledWith('/?api-key=test-helius-api-key', expect.any(Object), expect.any(Object));
    });

    it('should handle zero balance', async () => {
      mockPost.mockResolvedValue(ok(buildBalanceResponse(0)));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should return error for invalid Solana address', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'invalid-address' }));

      expect(error.message).toContain('Invalid Solana address');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should return error when result is missing', async () => {
      mockPost.mockResolvedValue(ok({ jsonrpc: '2.0', id: 1, result: null }));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toContain('Failed to fetch balance from Helius RPC');
    });

    it('should propagate API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Network timeout')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Network timeout');
    });
  });

  describe('execute - getAddressTokenBalances', () => {
    it('should return token balance data', async () => {
      mockPost.mockResolvedValue(ok(buildTokenAccountsResponse()));

      const result = expectOk(await client.execute({ type: 'getAddressTokenBalances', address: TEST_ADDRESS }));

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]!.contractAddress).toBe(MINT_ADDRESS);
      expect(result[0]!.rawAmount).toBe('1000000');
    });

    it('should return empty array when no token accounts', async () => {
      mockPost.mockResolvedValue(ok({ jsonrpc: '2.0', id: 1, result: { value: [] } }));

      const result = expectOk(await client.execute({ type: 'getAddressTokenBalances', address: TEST_ADDRESS }));

      expect(result).toEqual([]);
    });

    it('should return empty array when result is null', async () => {
      mockPost.mockResolvedValue(ok({ jsonrpc: '2.0', id: 1, result: null }));

      const result = expectOk(await client.execute({ type: 'getAddressTokenBalances', address: TEST_ADDRESS }));

      expect(result).toEqual([]);
    });

    it('should return error for invalid Solana address', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressTokenBalances', address: 'not-valid' }));

      expect(error.message).toContain('Invalid Solana address');
    });

    it('should propagate API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Rate limited')));

      const error = expectErr(await client.execute({ type: 'getAddressTokenBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Rate limited');
    });
  });

  describe('execute - getAddressStakingBalances', () => {
    it('should return stake account balances with category and account refs', async () => {
      mockPost.mockResolvedValueOnce(ok(buildStakeProgramAccountsResponse()));
      mockPost.mockResolvedValueOnce(ok(buildStakeProgramAccountsResponse()));
      mockPost.mockResolvedValueOnce(ok(buildStakeActivationResponse('active')));

      const result = expectOk(await client.execute({ type: 'getAddressStakingBalances', address: TEST_ADDRESS }));

      expect(result).toEqual([
        {
          accountAddress: STAKE_ACCOUNT,
          rawAmount: '2500000000',
          decimalAmount: '2.5',
          decimals: 9,
          symbol: 'SOL',
          balanceCategory: 'staked',
        },
      ]);
      const stakeAccountsCall = mockPost.mock.calls[0] as
        | [string, { method: string; params: [string, { filters: unknown[] }] }, unknown]
        | undefined;
      expect(stakeAccountsCall?.[0]).toBe('/?api-key=test-helius-api-key');
      expect(stakeAccountsCall?.[1].method).toBe('getProgramAccounts');
      expect(stakeAccountsCall?.[1].params[0]).toBe('Stake11111111111111111111111111111111111111');
      expect(stakeAccountsCall?.[1].params[1].filters).toEqual([
        { dataSize: 200 },
        { memcmp: { bytes: TEST_ADDRESS, offset: 12 } },
      ]);
      expect(mockPost).toHaveBeenNthCalledWith(
        3,
        '/?api-key=test-helius-api-key',
        expect.objectContaining({ method: 'getStakeActivation', params: [STAKE_ACCOUNT] }),
        expect.anything()
      );
    });

    it('should mark inactive stake accounts as unbonding reference balances', async () => {
      mockPost.mockResolvedValueOnce(ok(buildStakeProgramAccountsResponse()));
      mockPost.mockResolvedValueOnce(ok(buildStakeProgramAccountsResponse([])));
      mockPost.mockResolvedValueOnce(ok(buildStakeActivationResponse('inactive')));

      const result = expectOk(await client.execute({ type: 'getAddressStakingBalances', address: TEST_ADDRESS }));

      expect(result[0]?.balanceCategory).toBe('unbonding');
    });
  });

  describe('execute - getTokenMetadata', () => {
    it('should fetch single token metadata with getAsset', async () => {
      mockPost.mockResolvedValue(ok(buildAssetResponse()));

      const result = expectOk(await client.execute({ type: 'getTokenMetadata', contractAddresses: [MINT_ADDRESS] }));

      expect(result).toHaveLength(1);
      expect(result[0]!.symbol).toBe('USDC');
      expect(result[0]!.name).toBe('USD Coin');
      expect(result[0]!.decimals).toBe(6);
      expect(result[0]!.contractAddress).toBe(MINT_ADDRESS);
    });

    it('should fetch batch token metadata with getAssetBatch', async () => {
      const mint2 = 'So11111111111111111111111111111111111111112';
      mockPost.mockResolvedValue(
        ok({
          jsonrpc: '2.0',
          id: 1,
          result: [
            {
              content: { metadata: { name: 'USD Coin', symbol: 'USDC' }, links: { image: null } },
              token_info: { decimals: 6 },
            },
            { content: { metadata: { name: 'Wrapped SOL', symbol: 'SOL' }, links: null }, token_info: { decimals: 9 } },
          ],
        })
      );

      const result = expectOk(
        await client.execute({ type: 'getTokenMetadata', contractAddresses: [MINT_ADDRESS, mint2] })
      );

      expect(result).toHaveLength(2);
      expect(result[0]!.symbol).toBe('USDC');
      expect(result[1]!.symbol).toBe('SOL');
    });

    it('should return empty array for empty address list', async () => {
      const result = expectOk(await client.execute({ type: 'getTokenMetadata', contractAddresses: [] }));

      expect(result).toEqual([]);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should return error when asset result is missing', async () => {
      mockPost.mockResolvedValue(ok({ jsonrpc: '2.0', id: 1, result: null }));

      const error = expectErr(await client.execute({ type: 'getTokenMetadata', contractAddresses: [MINT_ADDRESS] }));

      expect(error.message).toContain('Token metadata not found');
    });

    it('should propagate API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Asset lookup failed')));

      const error = expectErr(await client.execute({ type: 'getTokenMetadata', contractAddresses: [MINT_ADDRESS] }));

      expect(error.message).toBe('Asset lookup failed');
    });
  });

  describe('execute - unsupported operation', () => {
    it('should return error for unknown operation type', async () => {
      const error = expectErr(
        await client.execute({
          address: TEST_ADDRESS,
          type: 'hasAddressTransactions',
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

    it('should stream normal transactions via two-call pattern', async () => {
      // Call 1: getSignaturesForAddress → 1 signature (< 100 = complete)
      mockPost.mockResolvedValueOnce(ok(buildSignaturesResponse([{ signature: SIGNATURE, slot: 200000000 }])));
      // Call 2: getTransaction → transaction details
      mockPost.mockResolvedValueOnce(ok({ jsonrpc: '2.0', id: 1, result: buildHeliusTransaction() }));

      const transactions: SolanaTransaction[] = [];
      for await (const result of client.executeStreaming<SolanaTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe(SIGNATURE);
      expect(transactions[0]!.providerName).toBe('helius');
      expect(transactions[0]!.status).toBe('success');
    });

    it('should complete immediately when no signatures', async () => {
      mockPost.mockResolvedValue(ok(buildSignaturesResponse([])));

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

    it('should propagate signature fetch errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Server error')));

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

    it('should stream token transactions using token accounts', async () => {
      // Call 1: getTokenAccountsByOwner → finds token accounts
      mockPost.mockResolvedValueOnce(ok(buildTokenAccountsResponse()));
      // Call 2: getSignaturesForAddress for token account → 1 signature
      mockPost.mockResolvedValueOnce(ok(buildSignaturesResponse([{ signature: SIGNATURE, slot: 200000000 }])));
      // Call 3: getTransaction → transaction details
      mockPost.mockResolvedValueOnce(ok({ jsonrpc: '2.0', id: 1, result: buildHeliusTransaction() }));

      const transactions: SolanaTransaction[] = [];
      for await (const result of client.executeStreaming<SolanaTransaction>({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'token',
      })) {
        const batch = expectOk(result);
        transactions.push(...batch.data.map((item) => item.normalized));
      }

      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.id).toBe(SIGNATURE);
    });

    it('should complete token stream when no token accounts found', async () => {
      mockPost.mockResolvedValueOnce(ok({ jsonrpc: '2.0', id: 1, result: { value: [] } }));

      const batches = [];
      for await (const result of client.executeStreaming({
        type: 'getAddressTransactions',
        address: TEST_ADDRESS,
        streamType: 'token',
      })) {
        batches.push(result);
      }

      expect(batches).toHaveLength(1);
      const batch = expectOk(batches[0]!);
      expect(batch.data).toHaveLength(0);
    });
  });

  describe('extractCursors', () => {
    it('should extract pageToken, timestamp, and blockNumber cursors', () => {
      const cursors = client.extractCursors({
        id: SIGNATURE,
        timestamp: 1700000000000,
        blockHeight: 200000000,
      } as SolanaTransaction);

      expect(cursors).toEqual([
        { type: 'pageToken', value: SIGNATURE, providerName: 'helius' },
        { type: 'timestamp', value: 1700000000000 },
        { type: 'blockNumber', value: 200000000 },
      ]);
    });

    it('should omit blockNumber when blockHeight is undefined', () => {
      const cursors = client.extractCursors({
        id: SIGNATURE,
        timestamp: 1700000000000,
      } as SolanaTransaction);

      expect(cursors).toHaveLength(2);
      expect(cursors[0]!.type).toBe('pageToken');
      expect(cursors[1]!.type).toBe('timestamp');
    });

    it('should omit pageToken when id is missing', () => {
      const cursors = client.extractCursors({
        timestamp: 1700000000000,
        blockHeight: 200000000,
      } as SolanaTransaction);

      expect(cursors).toHaveLength(2);
      expect(cursors[0]!.type).toBe('timestamp');
      expect(cursors[1]!.type).toBe('blockNumber');
    });

    it('should return empty array when no cursor fields', () => {
      const cursors = client.extractCursors({} as SolanaTransaction);
      expect(cursors).toEqual([]);
    });
  });

  describe('applyReplayWindow', () => {
    it('should pass through pageToken cursors unchanged', () => {
      const cursor = { type: 'pageToken' as const, value: SIGNATURE, providerName: 'helius' };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through blockNumber cursors unchanged', () => {
      const cursor = { type: 'blockNumber' as const, value: 200000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });

    it('should pass through timestamp cursors unchanged', () => {
      const cursor = { type: 'timestamp' as const, value: 1700000000000 };
      expect(client.applyReplayWindow(cursor)).toEqual(cursor);
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target the signed RPC endpoint via POST', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/?api-key=test-helius-api-key');
      expect(config.method).toBe('POST');
    });

    it('should use getHealth method in body', () => {
      const config = client.getHealthCheckConfig();
      expect(config.body).toMatchObject({ method: 'getHealth' });
    });

    it('should validate ok response', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ result: 'ok' })).toBe(true);
    });

    it('should reject non-ok responses', () => {
      const { validate } = client.getHealthCheckConfig();
      expect(validate({ result: 'error' })).toBe(false);
      expect(validate({ result: null })).toBe(false);
      expect(validate({})).toBe(false);
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
    });
  });
});
