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
import { SolanaRPCApiClient, solanaRpcMetadata } from '../solana-rpc.api-client.js';

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
const MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const STAKE_ACCOUNT = 'StakeAcct1111111111111111111111111111111111';
const TOKEN_ACCOUNT = 'TokenAcct111111111111111111111111111111111111';

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
                    amount: '500000',
                    decimals: 6,
                    uiAmount: 0.5,
                    uiAmountString: '0.5',
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

describe('SolanaRPCApiClient', () => {
  const providerRegistry = createProviderRegistry();
  let client: SolanaRPCApiClient;
  let mockPost: MockHttpClient['post'];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockHttpClient(mockHttp);

    const config = providerRegistry.createDefaultConfig('solana', 'solana-rpc');
    client = new SolanaRPCApiClient(config);
    injectMockHttpClient(client, mockHttp);
    mockPost = mockHttp.post;
  });

  describe('metadata', () => {
    it('should have correct provider identity', () => {
      expect(client).toBeInstanceOf(SolanaRPCApiClient);
      expect(client.blockchain).toBe('solana');
      expect(client.name).toBe('solana-rpc');
    });

    it('should not require API key', () => {
      expect(solanaRpcMetadata.requiresApiKey).toBe(false);
    });

    it('should support only balance operations (no streaming)', () => {
      const { capabilities } = client;
      expect(capabilities.supportedOperations).toEqual([
        'getAddressBalances',
        'getAddressStakingBalances',
        'getAddressTokenBalances',
      ]);
      expect(capabilities.supportedOperations).not.toContain('getAddressTransactions');
    });

    it('should have conservative rate limit configuration for public RPC', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(0.2);
      expect(rateLimit.burstLimit).toBe(1);
      expect(rateLimit.requestsPerMinute).toBe(12);
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
      expect(mockPost).toHaveBeenCalledWith(
        '/',
        expect.objectContaining({ method: 'getBalance', params: [TEST_ADDRESS] }),
        expect.anything()
      );
    });

    it('should handle zero balance', async () => {
      mockPost.mockResolvedValue(ok(buildBalanceResponse(0)));

      const result = expectOk(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(result.decimalAmount).toBe('0');
      expect(result.rawAmount).toBe('0');
    });

    it('should return error for invalid Solana address', async () => {
      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: 'not-valid' }));

      expect(error.message).toContain('Invalid Solana address');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should return error when result is missing', async () => {
      mockPost.mockResolvedValue(ok({ jsonrpc: '2.0', id: 1, result: null }));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toContain('Failed to fetch balance from Solana RPC');
    });

    it('should propagate API errors', async () => {
      mockPost.mockResolvedValue(err(new Error('Connection refused')));

      const error = expectErr(await client.execute({ type: 'getAddressBalances', address: TEST_ADDRESS }));

      expect(error.message).toBe('Connection refused');
    });
  });

  describe('execute - getAddressTokenBalances', () => {
    it('should return token balance data', async () => {
      mockPost.mockResolvedValue(ok(buildTokenAccountsResponse()));

      const result = expectOk(await client.execute({ type: 'getAddressTokenBalances', address: TEST_ADDRESS }));

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]!.rawAmount).toBe('500000');
      expect(result[0]!.decimals).toBe(6);
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
      const error = expectErr(await client.execute({ type: 'getAddressTokenBalances', address: 'bad-addr' }));

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
      expect(stakeAccountsCall?.[0]).toBe('/');
      expect(stakeAccountsCall?.[1].method).toBe('getProgramAccounts');
      expect(stakeAccountsCall?.[1].params[0]).toBe('Stake11111111111111111111111111111111111111');
      expect(stakeAccountsCall?.[1].params[1].filters).toEqual([
        { dataSize: 200 },
        { memcmp: { bytes: TEST_ADDRESS, offset: 12 } },
      ]);
      expect(mockPost).toHaveBeenNthCalledWith(
        3,
        '/',
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

    it('should return error for getAddressTransactions (no streaming support)', async () => {
      const error = expectErr(
        await client.execute({
          address: TEST_ADDRESS,
          type: 'getAddressTransactions',
        } as unknown as OneShotOperation)
      );

      expect(error.message).toContain('Unsupported operation');
    });
  });

  describe('getHealthCheckConfig', () => {
    it('should target / endpoint via POST', () => {
      const config = client.getHealthCheckConfig();
      expect(config.endpoint).toBe('/');
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
      expect(validate({ result: 'error' })).toBeFalsy();
      expect(validate({})).toBeFalsy();
      expect(validate(null)).toBeFalsy();
      expect(validate(undefined)).toBeFalsy();
    });
  });
});
