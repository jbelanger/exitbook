import type { UniversalExchangeAdapterConfig, UniversalFetchParams } from '@crypto/core';
import { Decimal } from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoinbaseAdapter } from '../adapter.js';
import { CoinbaseAPIClient } from '../coinbase-api-client.js';
import type { CoinbaseCredentials, RawCoinbaseAccount, RawCoinbaseTransaction } from '../types.js';

// Mock the API client
vi.mock('../coinbase-api-client');

// Mock the logger
vi.mock('@crypto/shared-logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('CoinbaseAdapter', () => {
  let mockApiClient: {
    getAccounts: ReturnType<typeof vi.fn>;
    getAccountTransactions: ReturnType<typeof vi.fn>;
    getRateLimitStatus: ReturnType<typeof vi.fn>;
    testConnection: ReturnType<typeof vi.fn>;
  };
  let adapter: CoinbaseAdapter;
  let config: UniversalExchangeAdapterConfig;
  let credentials: CoinbaseCredentials;

  beforeEach(() => {
    config = {
      credentials: {
        apiKey: 'test-key',
        password: 'test-passphrase',
        secret: 'test-secret',
      },
      id: 'coinbase',
      subType: 'native',
      type: 'exchange',
    };

    credentials = {
      apiKey: 'test-key',
      passphrase: 'test-passphrase',
      sandbox: true,
      secret: 'test-secret',
    };

    // Create mock API client
    mockApiClient = {
      getAccounts: vi.fn(),
      getAccountTransactions: vi.fn(),
      getRateLimitStatus: vi.fn(),
      testConnection: vi.fn(),
    };

    // Mock the CoinbaseAPIClient constructor
    const MockedCoinbaseAPIClient = CoinbaseAPIClient as unknown as ReturnType<typeof vi.fn>;
    MockedCoinbaseAPIClient.mockImplementation(() => mockApiClient);

    adapter = new CoinbaseAdapter(config, credentials);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getInfo', () => {
    it('should return correct adapter info', async () => {
      const info = await adapter.getInfo();

      expect(info).toEqual({
        capabilities: {
          maxBatchSize: 100,
          rateLimit: {
            burstLimit: 5,
            requestsPerSecond: 3,
          },
          requiresApiKey: true,
          supportedOperations: ['fetchTransactions', 'fetchBalances'],
          supportsHistoricalData: true,
          supportsPagination: true,
        },
        id: 'coinbase',
        name: 'Coinbase Track API',
        subType: 'native',
        type: 'exchange',
      });
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockApiClient.testConnection.mockResolvedValue(true);

      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockApiClient.testConnection).toHaveBeenCalledTimes(1);
    });

    it('should return false for failed connection', async () => {
      mockApiClient.testConnection.mockResolvedValue(false);

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it('should handle connection errors gracefully', async () => {
      mockApiClient.testConnection.mockRejectedValue(new Error('Network error'));

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('fetchTransactions', () => {
    const mockAccounts: RawCoinbaseAccount[] = [
      {
        balance: { amount: '1.0', currency: 'BTC' },
        created_at: '2022-01-01T00:00:00Z',
        currency: {
          code: 'BTC',
          color: '#f7931a',
          exponent: 8,
          name: 'Bitcoin',
          sort_index: 0,
          type: 'crypto',
        },
        id: 'account-1',
        name: 'BTC Wallet',
        primary: true,
        resource: 'account',
        resource_path: '/v2/accounts/account-1',
        type: 'wallet',
        updated_at: '2022-01-01T00:00:00Z',
      },
      {
        balance: { amount: '1000.0', currency: 'USD' },
        created_at: '2022-01-01T00:00:00Z',
        currency: {
          code: 'USD',
          color: '#85bb65',
          exponent: 2,
          name: 'US Dollar',
          sort_index: 100,
          type: 'fiat',
        },
        id: 'account-2',
        name: 'USD Wallet',
        primary: false,
        resource: 'account',
        resource_path: '/v2/accounts/account-2',
        type: 'fiat',
        updated_at: '2022-01-01T00:00:00Z',
      },
    ];

    beforeEach(() => {
      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);
    });

    it('should fetch and transform simple deposit transaction', async () => {
      const depositTransaction: RawCoinbaseTransaction = {
        amount: { amount: '100.00', currency: 'USD' },
        created_at: '2022-01-01T00:00:00Z',
        description: 'Bank deposit',
        id: 'deposit-123',
        native_amount: { amount: '100.00', currency: 'USD' },
        resource: 'transaction',
        resource_path: '/v2/accounts/account-1/transactions/deposit-123',
        status: 'completed',
        type: 'deposit',
        updated_at: '2022-01-01T00:00:00Z',
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [depositTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ['deposit'] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        amount: { amount: new Decimal('100.00'), currency: 'USD' },
        datetime: '2022-01-01T00:00:00.000Z',
        fee: { amount: new Decimal(0), currency: 'USD' },
        id: 'coinbase-track-deposit-123',
        metadata: {
          adapterType: 'track-api',
          nativeAmount: { amount: '100.00', currency: 'USD' },
          status: 'completed',
          trackTransaction: depositTransaction,
          transactionType: 'deposit',
        },
        side: 'buy',
        source: 'coinbase',
        status: 'closed',
        symbol: 'USD',
        timestamp: new Date('2022-01-01T00:00:00Z').getTime(),
        type: 'deposit',
      });
    });

    it('should fetch and transform simple withdrawal transaction', async () => {
      const withdrawalTransaction: RawCoinbaseTransaction = {
        amount: { amount: '-50.00', currency: 'USD' },
        created_at: '2022-01-01T12:00:00Z',
        description: 'Bank withdrawal',
        id: 'withdrawal-456',
        native_amount: { amount: '-50.00', currency: 'USD' },
        resource: 'transaction',
        resource_path: '/v2/accounts/account-2/transactions/withdrawal-456',
        status: 'completed',
        type: 'send',
        updated_at: '2022-01-01T12:00:00Z',
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [withdrawalTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ['withdrawal'] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        amount: { amount: new Decimal('50.00'), currency: 'USD' },
        datetime: '2022-01-01T12:00:00.000Z',
        fee: { amount: new Decimal(0), currency: 'USD' },
        id: 'coinbase-track-withdrawal-456',
        metadata: {
          adapterType: 'track-api',
          nativeAmount: { amount: '-50.00', currency: 'USD' },
          status: 'completed',
          trackTransaction: withdrawalTransaction,
          transactionType: 'send',
        },
        side: 'sell',
        source: 'coinbase',
        status: 'closed',
        symbol: 'USD',
        timestamp: new Date('2022-01-01T12:00:00Z').getTime(),
        type: 'withdrawal',
      });
    });

    it('should transform buy trade transaction correctly', async () => {
      const buyTransaction: RawCoinbaseTransaction = {
        amount: { amount: '0.01', currency: 'BTC' },
        buy: {
          id: 'order-123',
          resource: 'buy',
          resource_path: '/v2/accounts/account-1/buys/order-123',
        },
        created_at: '2022-01-01T10:00:00Z',
        description: 'Bought 0.01000000 BTC for $500.00',
        id: 'buy-123',
        native_amount: { amount: '500.00', currency: 'USD' },
        network: {
          status: 'confirmed',
          transaction_fee: {
            amount: '2.50',
            currency: 'USD',
          },
        },
        resource: 'transaction',
        resource_path: '/v2/accounts/account-1/transactions/buy-123',
        status: 'completed',
        type: 'buy',
        updated_at: '2022-01-01T10:00:00Z',
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [buyTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ['trade'] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        amount: { amount: new Decimal('0.01'), currency: 'BTC' },
        datetime: '2022-01-01T10:00:00.000Z',
        fee: { amount: new Decimal('2.50'), currency: 'USD' },
        id: 'coinbase-track-buy-123',
        metadata: {
          adapterType: 'track-api',
          nativeAmount: { amount: '500.00', currency: 'USD' },
          status: 'completed',
          trackTransaction: buyTransaction,
          transactionType: 'buy',
        },
        side: 'buy',
        source: 'coinbase',
        status: 'closed',
        symbol: 'BTC',
        timestamp: new Date('2022-01-01T10:00:00Z').getTime(),
        type: 'trade',
      });
    });

    it('should handle sell trades correctly', async () => {
      const sellTransaction: RawCoinbaseTransaction = {
        amount: { amount: '-0.005', currency: 'BTC' },
        created_at: '2022-01-02T15:30:00Z',
        description: 'Sold 0.00500000 BTC for $250.00',
        id: 'sell-789',
        native_amount: { amount: '250.00', currency: 'USD' },
        resource: 'transaction',
        resource_path: '/v2/accounts/account-1/transactions/sell-789',
        sell: {
          id: 'order-789',
          resource: 'sell',
          resource_path: '/v2/accounts/account-1/sells/order-789',
        },
        status: 'completed',
        type: 'sell',
        updated_at: '2022-01-02T15:30:00Z',
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [sellTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ['trade'] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        amount: { amount: new Decimal('0.005'), currency: 'BTC' },
        datetime: '2022-01-02T15:30:00.000Z',
        fee: { amount: new Decimal(0), currency: 'BTC' },
        id: 'coinbase-track-sell-789',
        metadata: {
          adapterType: 'track-api',
          nativeAmount: { amount: '250.00', currency: 'USD' },
          status: 'completed',
          trackTransaction: sellTransaction,
          transactionType: 'sell',
        },
        side: 'sell',
        source: 'coinbase',
        status: 'closed',
        symbol: 'BTC',
        timestamp: new Date('2022-01-02T15:30:00Z').getTime(),
        type: 'trade',
      });
    });

    it('should filter transactions by requested types', async () => {
      const mixedTransactions: RawCoinbaseTransaction[] = [
        {
          amount: { amount: '100.00', currency: 'USD' },
          created_at: '2022-01-01T00:00:00Z',
          description: 'Bank deposit',
          id: 'deposit-1',
          native_amount: { amount: '100.00', currency: 'USD' },
          resource: 'transaction',
          resource_path: '/v2/accounts/account-1/transactions/deposit-1',
          status: 'completed',
          type: 'deposit',
          updated_at: '2022-01-01T00:00:00Z',
        },
        {
          amount: { amount: '-50.00', currency: 'USD' },
          created_at: '2022-01-01T01:00:00Z',
          description: 'Bank withdrawal',
          id: 'withdrawal-1',
          native_amount: { amount: '-50.00', currency: 'USD' },
          resource: 'transaction',
          resource_path: '/v2/accounts/account-1/transactions/withdrawal-1',
          status: 'completed',
          type: 'send',
          updated_at: '2022-01-01T01:00:00Z',
        },
      ];

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: mixedTransactions, pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      // Request only deposits
      const params: UniversalFetchParams = { transactionTypes: ['deposit'] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0].type).toBe('deposit');
    });

    it('should handle account loading errors gracefully', async () => {
      mockApiClient.getAccounts.mockRejectedValue(new Error('API Error'));

      const params: UniversalFetchParams = { transactionTypes: ['trade'] };

      await expect(adapter.fetchTransactions(params)).rejects.toThrow('API Error');
    });

    it('should continue processing other accounts when one fails', async () => {
      mockApiClient.getAccountTransactions.mockRejectedValueOnce(new Error('Account 1 failed')).mockResolvedValueOnce({
        data: [
          {
            amount: { amount: '100.00', currency: 'USD' },
            created_at: '2022-01-01T00:00:00Z',
            description: 'Bank deposit',
            id: 'entry-1',
            native_amount: { amount: '100.00', currency: 'USD' },
            resource: 'transaction',
            resource_path: '/v2/accounts/account-2/transactions/entry-1',
            status: 'completed',
            type: 'deposit',
            updated_at: '2022-01-01T00:00:00Z',
          },
        ],
        pagination: {},
      });

      const params: UniversalFetchParams = { transactionTypes: ['deposit'] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(mockApiClient.getAccountTransactions).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchBalances', () => {
    it('should transform account balances correctly', async () => {
      const mockAccounts: RawCoinbaseAccount[] = [
        {
          balance: { amount: '1.5', currency: 'BTC' },
          created_at: '2022-01-01T00:00:00Z',
          currency: {
            code: 'BTC',
            color: '#f7931a',
            exponent: 8,
            name: 'Bitcoin',
            sort_index: 0,
            type: 'crypto',
          },
          id: 'account-1',
          name: 'BTC Wallet',
          primary: true,
          resource: 'account',
          resource_path: '/v2/accounts/account-1',
          type: 'wallet',
          updated_at: '2022-01-01T00:00:00Z',
        },
        {
          balance: { amount: '1000.00', currency: 'USD' },
          created_at: '2022-01-01T00:00:00Z',
          currency: {
            code: 'USD',
            color: '#85bb65',
            exponent: 2,
            name: 'US Dollar',
            sort_index: 100,
            type: 'fiat',
          },
          id: 'account-2',
          name: 'USD Wallet',
          primary: false,
          resource: 'account',
          resource_path: '/v2/accounts/account-2',
          type: 'fiat',
          updated_at: '2022-01-01T00:00:00Z',
        },
      ];

      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);

      const balances = await adapter.fetchBalances({});

      expect(balances).toHaveLength(2);

      expect(balances[0]).toEqual({
        currency: 'BTC',
        free: 1.5,
        total: 1.5,
        used: 0,
      });

      expect(balances[1]).toEqual({
        currency: 'USD',
        free: 1000.0,
        total: 1000.0,
        used: 0,
      });
    });

    it('should exclude zero-balance accounts', async () => {
      const mockAccounts: RawCoinbaseAccount[] = [
        {
          balance: { amount: '0', currency: 'BTC' },
          created_at: '2022-01-01T00:00:00Z',
          currency: {
            code: 'BTC',
            color: '#f7931a',
            exponent: 8,
            name: 'Bitcoin',
            sort_index: 0,
            type: 'crypto',
          },
          id: 'account-1',
          name: 'BTC Wallet',
          primary: true,
          resource: 'account',
          resource_path: '/v2/accounts/account-1',
          type: 'wallet',
          updated_at: '2022-01-01T00:00:00Z',
        },
        {
          balance: { amount: '100.00', currency: 'USD' },
          created_at: '2022-01-01T00:00:00Z',
          currency: {
            code: 'USD',
            color: '#85bb65',
            exponent: 2,
            name: 'US Dollar',
            sort_index: 100,
            type: 'fiat',
          },
          id: 'account-2',
          name: 'USD Wallet',
          primary: false,
          resource: 'account',
          resource_path: '/v2/accounts/account-2',
          type: 'fiat',
          updated_at: '2022-01-01T00:00:00Z',
        },
      ];

      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);

      const balances = await adapter.fetchBalances({});

      expect(balances).toHaveLength(1);
      expect(balances[0].currency).toBe('USD');
    });
  });
});
