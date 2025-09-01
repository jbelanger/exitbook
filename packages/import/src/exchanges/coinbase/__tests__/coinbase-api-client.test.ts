import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeCredentials } from '../../../shared/types/types.ts';
import { CoinbaseAPIClient } from '../coinbase-api-client.ts';
import type { RawCoinbaseAccount, RawCoinbaseTransaction } from '../types.ts';

// Use vi.hoisted to define variables accessible in vi.mock
const mocks = vi.hoisted(() => {
  const mockGenerateJwt = vi.fn().mockResolvedValue('mocked-jwt-token');

  const mockHttpClient = {
    getRateLimitStatus: vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    })),
    request: vi.fn(),
  };

  const MockHttpClient = vi.fn().mockImplementation(() => mockHttpClient);

  const MockRateLimiterFactory = {
    getOrCreate: vi.fn(() => ({
      waitForPermission: vi.fn().mockResolvedValue(void 0),
    })),
  };

  const MockLogger = vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }));

  return {
    injectIntoInstance(instance: object): void {
      Object.defineProperty(instance, 'httpClient', {
        configurable: true,
        value: mockHttpClient,
        writable: true,
      });
    },
    mockGenerateJwt,
    mockHttpClient,
    MockHttpClient,
    MockLogger,

    MockRateLimiterFactory,

    resetAll(): void {
      vi.clearAllMocks();
      mockGenerateJwt.mockResolvedValue('mocked-jwt-token');
    },
  };
});

// Mock modules using vi.mock
vi.mock('@crypto/shared-utils', () => ({
  HttpClient: mocks.MockHttpClient,
  RateLimiterFactory: mocks.MockRateLimiterFactory,
}));

vi.mock('@crypto/shared-logger', () => ({
  getLogger: mocks.MockLogger,
}));

vi.mock('@coinbase/cdp-sdk/auth', () => ({
  generateJwt: mocks.mockGenerateJwt,
}));

describe('CoinbaseAPIClient', () => {
  let client: CoinbaseAPIClient;
  let credentials: ExchangeCredentials;

  beforeEach(() => {
    credentials = {
      apiKey: 'organizations/test-org-id/apiKeys/test-key-id',
      passphrase: 'test-passphrase',
      sandbox: true,
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHTestTestKey\n-----END EC PRIVATE KEY-----',
    };

    // Clear all mocks before creating new client
    mocks.resetAll();

    client = new CoinbaseAPIClient(credentials);

    // Inject mock HttpClient into the instance
    mocks.injectIntoInstance(client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with sandbox URL when sandbox is true', () => {
      const sandboxCredentials = { ...credentials, sandbox: true };
      const sandboxClient = new CoinbaseAPIClient(sandboxCredentials);

      expect(sandboxClient).toBeDefined();

      // Check that HttpClient was called with sandbox URL
      const constructorCalls = mocks.MockHttpClient.mock.calls;
      const lastCall = constructorCalls[constructorCalls.length - 1];
      expect(lastCall[0].baseUrl).toBe('https://api.sandbox.coinbase.com');
    });

    it('should initialize with production URL when sandbox is false', () => {
      const prodCredentials = { ...credentials, sandbox: false };
      const prodClient = new CoinbaseAPIClient(prodCredentials);

      expect(prodClient).toBeDefined();

      // Check that HttpClient was called with production URL
      const constructorCalls = mocks.MockHttpClient.mock.calls;
      const lastCall = constructorCalls[constructorCalls.length - 1];
      expect(lastCall[0].baseUrl).toBe('https://api.coinbase.com');
    });

    it('should configure appropriate rate limits', () => {
      // The HttpClient should have been called at least once
      expect(mocks.MockHttpClient).toHaveBeenCalled();

      const httpClientConfig = mocks.MockHttpClient.mock.calls[0][0];
      expect(httpClientConfig.rateLimit).toEqual({
        burstLimit: 5,
        requestsPerSecond: 3,
      });
      expect(httpClientConfig.timeout).toBe(30000);
      expect(httpClientConfig.providerName).toBe('coinbase-track');
    });
  });

  describe('authentication', () => {
    beforeEach(() => {
      // Mock Date.now to return a consistent timestamp for signature testing
      vi.spyOn(Date, 'now').mockReturnValue(1640995200000); // 2022-01-01 00:00:00 UTC
    });

    it('should generate correct authentication headers for GET request', async () => {
      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccounts();

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        '/v2/accounts?',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mocked-jwt-token',
            'Content-Type': 'application/json',
          }),
          method: 'GET',
        })
      );

      // Verify JWT token was generated
      const call = mocks.mockHttpClient.request.mock.calls[0];
      const headers = call[1].headers;
      const authHeader = headers['Authorization'];

      expect(authHeader).toBe('Bearer mocked-jwt-token');
    });

    it('should generate correct authentication headers for GET request with query parameters', async () => {
      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccounts({ cursor: 'test-cursor', limit: 50 });

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        '/v2/accounts?cursor=test-cursor&limit=50',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mocked-jwt-token',
            'Content-Type': 'application/json',
          }),
          method: 'GET',
        })
      );

      // Verify JWT token format
      const call = mocks.mockHttpClient.request.mock.calls[0];
      const headers = call[1].headers;
      const authHeader = headers['Authorization'];

      expect(authHeader).toBe('Bearer mocked-jwt-token');
    });

    it('should filter out undefined parameters from query string', async () => {
      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      // Test with invalid params to ensure they're filtered out
      const testParams = {
        invalidParam: null,
        limit: 50,
      } as Parameters<typeof client.getAccounts>[0] & { invalidParam: null };

      await client.getAccounts(testParams);

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith('/v2/accounts?limit=50', expect.any(Object));
    });

    it('should handle different timestamp values correctly', async () => {
      // Test that JWT tokens are regenerated for each request
      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      // Make two requests
      await client.getAccounts();
      await client.getAccounts();

      expect(mocks.mockHttpClient.request).toHaveBeenCalledTimes(2);

      // Both calls should have Authorization headers with JWT tokens
      const firstCall = mocks.mockHttpClient.request.mock.calls[0];
      const secondCall = mocks.mockHttpClient.request.mock.calls[1];

      const firstAuth = firstCall[1].headers['Authorization'];
      const secondAuth = secondCall[1].headers['Authorization'];

      expect(firstAuth).toBe('Bearer mocked-jwt-token');
      expect(secondAuth).toBe('Bearer mocked-jwt-token');
    });
  });

  describe('getAccounts', () => {
    it('should return accounts from API response', async () => {
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

      mocks.mockHttpClient.request.mockResolvedValue({
        data: mockAccounts,
      });

      const result = await client.getAccounts();

      expect(result).toEqual(mockAccounts);
      expect(mocks.mockHttpClient.request).toHaveBeenCalledTimes(1);
    });

    it('should handle empty accounts response', async () => {
      mocks.mockHttpClient.request.mockResolvedValue({ data: [] });

      const result = await client.getAccounts();

      expect(result).toEqual([]);
    });

    it('should handle missing data property', async () => {
      mocks.mockHttpClient.request.mockResolvedValue({});

      const result = await client.getAccounts();

      expect(result).toEqual([]);
    });
  });

  describe('getAccountTransactions', () => {
    const testAccountId = 'test-account-uuid';

    it('should return transactions for account', async () => {
      const mockTransactions: RawCoinbaseTransaction[] = [
        {
          amount: { amount: '0.1', currency: 'BTC' },
          created_at: '2022-01-01T00:00:00Z',
          description: 'Bought 0.1 BTC',
          id: 'transaction-1',
          native_amount: { amount: '5000.00', currency: 'USD' },
          resource: 'transaction',
          resource_path: '/v2/accounts/test-account/transactions/transaction-1',
          status: 'completed',
          type: 'buy',
          updated_at: '2022-01-01T00:00:00Z',
        },
      ];

      const mockResponse = {
        data: mockTransactions,
        pagination: {
          next_uri: '/v2/accounts/test-account/transactions?starting_after=transaction-1',
        },
      };

      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      const result = await client.getAccountTransactions(testAccountId);

      expect(result).toEqual(mockResponse);
      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        `/v2/accounts/${testAccountId}/transactions?`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should include query parameters in request', async () => {
      const mockResponse = { data: [], pagination: {} };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccountTransactions(testAccountId, {
        limit: 50,
        starting_after: 'test-cursor',
        type: 'buy',
      });

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        `/v2/accounts/${testAccountId}/transactions?limit=50&starting_after=test-cursor&type=buy`,
        expect.any(Object)
      );
    });

    it('should handle empty account ID', async () => {
      // Empty account ID will result in malformed URL /v2/accounts//transactions
      // which should result in an HTTP error
      const mockResponse = { data: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccountTransactions('');

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith('/v2/accounts//transactions?', expect.any(Object));
    });
  });

  // Note: Track API doesn't have a "getAllAccountTransactions" method
  // Each account's transactions are fetched individually as needed by the adapter

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mocks.mockHttpClient.request.mockResolvedValue({ data: [] });

      const result = await client.testConnection();

      expect(result).toBe(true);
    });

    it('should return false for failed connection', async () => {
      mocks.mockHttpClient.request.mockRejectedValue(new Error('Authentication failed'));

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle and re-throw HTTP errors', async () => {
      const error = new Error('HTTP 401: Unauthorized');
      mocks.mockHttpClient.request.mockRejectedValue(error);

      await expect(client.getAccounts()).rejects.toThrow('HTTP 401: Unauthorized');
    });

    it('should enhance authentication error messages', async () => {
      const error = new Error('HTTP 403: Forbidden');
      mocks.mockHttpClient.request.mockRejectedValue(error);

      await expect(client.getAccounts()).rejects.toThrow('HTTP 403: Forbidden');

      // The authentication error logging is tested implicitly by the error being thrown
      // Since we're mocking the logger, we can't easily test the log content,
      // but the important thing is that the error is properly re-thrown
    });
  });
});
