import { ok, err } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderOperation } from '../../../../../shared/blockchain/index.ts';
import { ProviderRegistry } from '../../../../../shared/blockchain/index.ts';
import { TatumBitcoinApiClient } from '../tatum-bitcoin.api-client.js';
import type { TatumBitcoinTransaction, TatumBitcoinBalance } from '../tatum.schemas.js';

const mockHttpClient = {
  get: vi.fn(),
  getRateLimitStatus: vi.fn(() => ({
    remainingRequests: 10,
    resetTime: Date.now() + 60000,
  })),
  request: vi.fn(),
};

vi.mock('@exitbook/shared-utils', () => ({
  HttpClient: vi.fn(() => mockHttpClient),
  maskAddress: (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`,
}));

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.stubEnv('TATUM_API_KEY', 'test-api-key');

describe('TatumBitcoinApiClient', () => {
  let client: TatumBitcoinApiClient;
  let mockHttpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient.get = vi.fn();
    mockHttpClient.request = vi.fn();
    mockHttpClient.getRateLimitStatus = vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    }));
    const config = ProviderRegistry.createDefaultConfig('bitcoin', 'tatum');
    client = new TatumBitcoinApiClient(config);
    Object.defineProperty(client, 'httpClient', {
      configurable: true,
      value: mockHttpClient,
      writable: true,
    });
    mockHttpGet = mockHttpClient.get;
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeInstanceOf(TatumBitcoinApiClient);
      expect(client.blockchain).toBe('bitcoin');
      expect(client.name).toBe('tatum');
    });

    it('should have correct rate limit configuration', () => {
      const rateLimit = client.rateLimit;
      expect(rateLimit.requestsPerSecond).toBe(3);
      expect(rateLimit.burstLimit).toBe(50);
      expect(rateLimit.requestsPerMinute).toBe(180);
    });
  });

  describe('getAddressTransactions', () => {
    const mockAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    const mockTransactions: TatumBitcoinTransaction[] = [
      {
        block: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
        blockNumber: 910910,
        fee: '390',
        hash: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
        hex: '02000000000102b80f2d35fc56c813dd58ca27edfc753eff8e552eee37b405f02b79d7a8578fab0000000000ffffffff684aeeb7c2712211d28be2f5b9bfedaea20a0fa97c1f613a9e9179a82bf8c7ed00000000025100ffffffff01d67c0000000000002251200781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac201408346f64d1e885a57a632c1a399f7627061aac3f0190b45800161522417a0f49c7ffa31b513c4edbfc26a4dc04d62c613a8e7423e1caacba332c8ecdbceeed3be0000000000',
        index: 522,
        inputs: [
          {
            coin: {
              address: 'bc1pws6pvj75rcsc2eglpp9k570prnjh40nfpyahlyumk8y8smjayvasyhns5c',
              coinbase: false,
              height: 910898,
              reqSigs: undefined,
              script: '51207434164bd41e2185651f084b6a79e11ce57abe69093b7f939bb1c8786e5d233b',
              type: undefined,
              value: 3586,
              version: 2,
            },
            prevout: {
              hash: 'ab8f57a8d7792bf005b437ee2e558eff3e75fced27ca58dd13c856fc352d0fb8',
              index: 0,
            },
            script: '',
            sequence: 4294967295,
          },
        ],
        locktime: 0,
        outputs: [
          {
            address: 'bc1pq7qldvzhmdtg34g944z2eeufrftcuqtuls5l75t8l8st7dls4rtpquaguma',
            script: '51200781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac2',
            scriptPubKey: {
              reqSigs: undefined,
              type: 'witness_v1_taproot',
            },
            value: 31958,
          },
        ],
        size: 206,
        time: 1755706690,
        version: 2,
        vsize: 155,
        weight: 617,
        witnessHash: '1c4aedc7b78c01f7ecd3a7d0e98580360a9add6754cf623265d9304254992db7',
      },
    ];

    it('should fetch transactions successfully', async () => {
      mockHttpGet.mockResolvedValue(ok(mockTransactions));

      const result = await client.getAddressTransactions(mockAddress);

      expect(mockHttpGet).toHaveBeenCalledWith(`/transaction/address/${mockAddress}?offset=0&pageSize=50`);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.normalized).toMatchObject({
          currency: 'BTC',
          id: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
          providerName: 'tatum',
          status: 'success',
          timestamp: 1755706690000,
          blockHeight: 910910,
          blockId: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
        });
        const tx = result.value[0];
        expect(tx).toBeDefined();
        expect(tx?.normalized.inputs).toBeDefined();
        expect(tx?.normalized.inputs).toHaveLength(1);
        expect(tx?.normalized.outputs).toBeDefined();
        expect(tx?.normalized.outputs).toHaveLength(1);
        expect(tx?.raw).toBeDefined();
        expect(tx?.raw).toEqual(mockTransactions[0]);
      }
    });

    it('should handle custom parameters', async () => {
      mockHttpGet.mockResolvedValue(ok(mockTransactions));

      const result = await client.getAddressTransactions(mockAddress, {
        blockFrom: 100,
        blockTo: 200,
        offset: 10,
        pageSize: 25,
        txType: 'incoming',
      });

      expect(mockHttpGet).toHaveBeenCalledWith(
        `/transaction/address/${mockAddress}?offset=10&pageSize=25&blockFrom=100&blockTo=200&txType=incoming`
      );
      expect(result.isOk()).toBe(true);
    });

    it('should limit pageSize to 50 max', async () => {
      mockHttpGet.mockResolvedValue(ok(mockTransactions));

      const result = await client.getAddressTransactions(mockAddress, { pageSize: 100 });

      expect(mockHttpGet).toHaveBeenCalledWith(`/transaction/address/${mockAddress}?offset=0&pageSize=50`);
      expect(result.isOk()).toBe(true);
    });

    it('should return empty array when no transactions found', async () => {
      mockHttpGet.mockResolvedValue(ok([]));

      const result = await client.getAddressTransactions(mockAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should throw error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const result = await client.getAddressTransactions(mockAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });
  });

  describe('getAddressBalances', () => {
    const mockAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    const mockBalance: TatumBitcoinBalance = {
      incoming: '5000000000',
      outgoing: '1000000000',
    };

    it('should fetch balance successfully', async () => {
      mockHttpGet.mockResolvedValueOnce(ok(mockBalance)); // Call for balance

      const result = await client.getAddressBalances(mockAddress);

      expect(mockHttpGet).toHaveBeenCalledWith(`/address/balance/${mockAddress}`);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          rawAmount: '4000000000', // 5000000000 - 1000000000
          symbol: 'BTC',
          decimals: 8,
          decimalAmount: '40', // (5000000000 - 1000000000) / 100000000
        });
      }
    });

    it('should throw error on API failure', async () => {
      const error = new Error('API Error');
      mockHttpGet.mockResolvedValue(err(error));

      const result = await client.getAddressBalances(mockAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API Error');
      }
    });
  });

  describe('execute', () => {
    const mockAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    it('should execute getAddressTransactions operation', async () => {
      const mockTransactions: TatumBitcoinTransaction[] = [];
      mockHttpGet.mockResolvedValue(ok(mockTransactions));

      const result = await client.execute({
        address: mockAddress,
        limit: undefined,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(mockTransactions);
      }
    });

    it('should execute getAddressBalances operation', async () => {
      const mockBalance: TatumBitcoinBalance = {
        incoming: '5000000000',
        outgoing: '1000000000',
      };

      mockHttpGet.mockResolvedValueOnce(ok(mockBalance)); // Call for balance

      const result = await client.execute({
        address: mockAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          rawAmount: '4000000000', // 5000000000 - 1000000000
          symbol: 'BTC',
          decimals: 8,
          decimalAmount: '40', // (5000000000 - 1000000000) / 100000000
        });
      }
    });

    it('should throw error for unsupported operation', async () => {
      const result = await client.execute({
        address: mockAddress,
        type: 'unsupportedOperation' as const,
      } as unknown as ProviderOperation);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Unsupported operation: unsupportedOperation');
      }
    });
  });

  describe('isHealthy', () => {
    it('should return true when API is healthy', async () => {
      const mockBalance: TatumBitcoinBalance = {
        incoming: '0',
        outgoing: '0',
      };
      mockHttpGet.mockResolvedValue(ok(mockBalance));

      const result = await client.isHealthy();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
      expect(mockHttpGet).toHaveBeenCalledWith('/address/balance/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    });

    it('should return false when API is unhealthy', async () => {
      mockHttpGet.mockResolvedValue(err(new Error('API Error')));

      const result = await client.isHealthy();

      expect(result.isErr()).toBe(true);
    });
  });

  describe('capabilities', () => {
    it('should have correct capabilities', () => {
      const capabilities = client.capabilities;

      expect(capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(capabilities.supportedOperations).toContain('getAddressBalances');
    });
  });
});
