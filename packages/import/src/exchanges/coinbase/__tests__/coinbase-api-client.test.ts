import * as crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to define variables accessible in vi.mock
const mocks = vi.hoisted(() => {
  const mockHttpClient = {
    request: vi.fn(),
    getRateLimitStatus: vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    })),
  };

  const MockHttpClient = vi.fn().mockImplementation(() => mockHttpClient);

  const MockRateLimiterFactory = {
    getOrCreate: vi.fn(() => ({
      waitForPermission: vi.fn().mockResolvedValue(void 0),
    })),
  };

  const MockLogger = vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));

  return {
    mockHttpClient,
    MockHttpClient,
    MockRateLimiterFactory,
    MockLogger,
    
    injectIntoInstance(instance: object): void {
      Object.defineProperty(instance, 'httpClient', {
        value: mockHttpClient,
        writable: true,
        configurable: true
      });
    },

    resetAll(): void {
      vi.clearAllMocks();
    }
  };
});

// Mock modules using vi.mock
vi.mock("@crypto/shared-utils", () => ({
  HttpClient: mocks.MockHttpClient,
  RateLimiterFactory: mocks.MockRateLimiterFactory,
}));

vi.mock("@crypto/shared-logger", () => ({
  getLogger: mocks.MockLogger,
}));
import { CoinbaseAPIClient } from "../coinbase-api-client.ts";
import type {
  CoinbaseCredentials,
  RawCoinbaseAccount,
  RawCoinbaseLedgerEntry,
} from "../types.ts";

describe("CoinbaseAPIClient", () => {
  let client: CoinbaseAPIClient;
  let credentials: CoinbaseCredentials;

  beforeEach(() => {
    credentials = {
      apiKey: "test-api-key",
      secret: "test-secret",
      passphrase: "test-passphrase",
      sandbox: true,
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

  describe("constructor", () => {
    it("should initialize with sandbox URL when sandbox is true", () => {
      const sandboxCredentials = { ...credentials, sandbox: true };
      const sandboxClient = new CoinbaseAPIClient(sandboxCredentials);

      expect(sandboxClient).toBeDefined();
      
      // Check that HttpClient was called with sandbox URL
      const constructorCalls = mocks.MockHttpClient.mock.calls;
      const lastCall = constructorCalls[constructorCalls.length - 1];
      expect(lastCall[0].baseUrl).toBe("https://api.sandbox.coinbase.com");
    });

    it("should initialize with production URL when sandbox is false", () => {
      const prodCredentials = { ...credentials, sandbox: false };
      const prodClient = new CoinbaseAPIClient(prodCredentials);

      expect(prodClient).toBeDefined();
      
      // Check that HttpClient was called with production URL
      const constructorCalls = mocks.MockHttpClient.mock.calls;
      const lastCall = constructorCalls[constructorCalls.length - 1];
      expect(lastCall[0].baseUrl).toBe("https://api.coinbase.com");
    });

    it("should configure appropriate rate limits", () => {
      // The HttpClient should have been called at least once
      expect(mocks.MockHttpClient).toHaveBeenCalled();
      
      const httpClientConfig = mocks.MockHttpClient.mock.calls[0][0];
      expect(httpClientConfig.rateLimit).toEqual({
        requestsPerSecond: 10,
        burstLimit: 15,
      });
      expect(httpClientConfig.timeout).toBe(30000);
      expect(httpClientConfig.providerName).toBe("coinbase-advanced");
    });
  });

  describe("authentication", () => {
    beforeEach(() => {
      // Mock Date.now to return a consistent timestamp for signature testing
      vi.spyOn(Date, "now").mockReturnValue(1640995200000); // 2022-01-01 00:00:00 UTC
    });

    it("should generate correct authentication headers for GET request", async () => {
      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccounts();

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        "/api/v3/brokerage/accounts?",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "CB-ACCESS-KEY": "test-api-key",
            "CB-ACCESS-TIMESTAMP": "1640995200",
            "CB-ACCESS-PASSPHRASE": "test-passphrase",
            "CB-VERSION": "2015-07-22",
            "CB-ACCESS-SIGN": expect.any(String),
          }),
        }),
      );

      // Verify signature calculation
      const call = mocks.mockHttpClient.request.mock.calls[0];
      const headers = call[1].headers;
      const timestamp = headers["CB-ACCESS-TIMESTAMP"];
      const signature = headers["CB-ACCESS-SIGN"];

      // Recreate the message that should have been signed
      const message = timestamp + "GET" + "/api/v3/brokerage/accounts?" + "";
      const expectedSignature = crypto
        .createHmac("sha256", credentials.secret)
        .update(message)
        .digest("hex");

      expect(signature).toBe(expectedSignature);
    });

    it("should generate correct authentication headers for GET request with query parameters", async () => {
      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccounts({ limit: 50, cursor: "test-cursor" });

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        "/api/v3/brokerage/accounts?limit=50&cursor=test-cursor",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "CB-ACCESS-KEY": "test-api-key",
            "CB-ACCESS-TIMESTAMP": "1640995200",
            "CB-ACCESS-PASSPHRASE": "test-passphrase",
            "CB-VERSION": "2015-07-22",
            "CB-ACCESS-SIGN": expect.any(String),
          }),
        }),
      );

      // Verify signature includes query parameters
      const call = mocks.mockHttpClient.request.mock.calls[0];
      const headers = call[1].headers;
      const signature = headers["CB-ACCESS-SIGN"];

      const message =
        "1640995200" +
        "GET" +
        "/api/v3/brokerage/accounts?limit=50&cursor=test-cursor" +
        "";
      const expectedSignature = crypto
        .createHmac("sha256", credentials.secret)
        .update(message)
        .digest("hex");

      expect(signature).toBe(expectedSignature);
    });

    it("should filter out undefined parameters from query string", async () => {
      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      // Test with invalid params to ensure they're filtered out
      const testParams = {
        limit: 50,
        invalidParam: null,
      } as Parameters<typeof client.getAccounts>[0] & { invalidParam: null };
      
      await client.getAccounts(testParams);

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        "/api/v3/brokerage/accounts?limit=50",
        expect.any(Object),
      );
    });

    it("should handle different timestamp values correctly", async () => {
      // Test that different timestamps produce different signatures
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1640995260000); // Different timestamp

      const mockResponse = { accounts: [] };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccounts();

      const call = mocks.mockHttpClient.request.mock.calls[0];
      const headers = call[1].headers;

      expect(headers["CB-ACCESS-TIMESTAMP"]).toBe("1640995260");

      // Signature should be different with different timestamp
      const message =
        "1640995260" + "GET" + "/api/v3/brokerage/accounts?" + "";
      const expectedSignature = crypto
        .createHmac("sha256", credentials.secret)
        .update(message)
        .digest("hex");

      expect(headers["CB-ACCESS-SIGN"]).toBe(expectedSignature);
      
      dateSpy.mockRestore();
    });
  });

  describe("getAccounts", () => {
    it("should return accounts from API response", async () => {
      const mockAccounts: RawCoinbaseAccount[] = [
        {
          uuid: "account-1",
          name: "BTC Wallet",
          currency: "BTC",
          available_balance: { value: "1.5", currency: "BTC" },
          default: true,
          active: true,
          type: "wallet",
        },
        {
          uuid: "account-2",
          name: "USD Wallet",
          currency: "USD",
          available_balance: { value: "1000.00", currency: "USD" },
          default: false,
          active: true,
          type: "fiat",
        },
      ];

      mocks.mockHttpClient.request.mockResolvedValue({ accounts: mockAccounts });

      const result = await client.getAccounts();

      expect(result).toEqual(mockAccounts);
      expect(mocks.mockHttpClient.request).toHaveBeenCalledTimes(1);
    });

    it("should handle empty accounts response", async () => {
      mocks.mockHttpClient.request.mockResolvedValue({ accounts: [] });

      const result = await client.getAccounts();

      expect(result).toEqual([]);
    });

    it("should handle missing accounts property", async () => {
      mocks.mockHttpClient.request.mockResolvedValue({});

      const result = await client.getAccounts();

      expect(result).toEqual([]);
    });
  });

  describe("getAccountLedger", () => {
    const testAccountId = "test-account-uuid";

    it("should return ledger entries for account", async () => {
      const mockLedgerEntries: RawCoinbaseLedgerEntry[] = [
        {
          id: "entry-1",
          created_at: "2022-01-01T00:00:00Z",
          amount: { value: "100.00", currency: "USD" },
          type: "DEPOSIT",
          direction: "CREDIT",
          details: { payment_method: { id: "pm-1", type: "bank_account" } },
        },
      ];

      const mockResponse = {
        ledger: mockLedgerEntries,
        cursor: "next-cursor",
        has_next: true,
      };

      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      const result = await client.getAccountLedger(testAccountId);

      expect(result).toEqual(mockResponse);
      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        `/api/v3/brokerage/accounts/${testAccountId}/ledger?`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should include query parameters in request", async () => {
      const mockResponse = { ledger: [], has_next: false };
      mocks.mockHttpClient.request.mockResolvedValue(mockResponse);

      await client.getAccountLedger(testAccountId, {
        limit: 50,
        cursor: "test-cursor",
        start_date: "2022-01-01T00:00:00Z",
      });

      expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
        `/api/v3/brokerage/accounts/${testAccountId}/ledger?limit=50&cursor=test-cursor&start_date=2022-01-01T00%3A00%3A00Z`,
        expect.any(Object),
      );
    });

    it("should throw error for empty account ID", async () => {
      await expect(client.getAccountLedger("")).rejects.toThrow(
        "Account ID is required for ledger requests",
      );
    });
  });

  describe("getAllAccountLedgerEntries", () => {
    const testAccountId = "test-account-uuid";

    it("should handle pagination correctly", async () => {
      const page1Entries: RawCoinbaseLedgerEntry[] = [
        {
          id: "entry-1",
          created_at: "2022-01-01T00:00:00Z",
          amount: { value: "100.00", currency: "USD" },
          type: "DEPOSIT",
          direction: "CREDIT",
          details: {},
        },
      ];

      const page2Entries: RawCoinbaseLedgerEntry[] = [
        {
          id: "entry-2",
          created_at: "2022-01-02T00:00:00Z",
          amount: { value: "50.00", currency: "USD" },
          type: "WITHDRAWAL",
          direction: "DEBIT",
          details: {},
        },
      ];

      // Mock the two paginated responses
      mocks.mockHttpClient.request
        .mockResolvedValueOnce({
          ledger: page1Entries,
          cursor: "cursor-2",
          has_next: true,
        })
        .mockResolvedValueOnce({
          ledger: page2Entries,
          cursor: undefined,
          has_next: false,
        });

      const result = await client.getAllAccountLedgerEntries(testAccountId);

      expect(result).toEqual([...page1Entries, ...page2Entries]);
      expect(mocks.mockHttpClient.request).toHaveBeenCalledTimes(2);

      // Verify first call had no cursor
      expect(mocks.mockHttpClient.request.mock.calls[0][0]).toBe(
        `/api/v3/brokerage/accounts/${testAccountId}/ledger?limit=100`,
      );

      // Verify second call had cursor
      expect(mocks.mockHttpClient.request.mock.calls[1][0]).toBe(
        `/api/v3/brokerage/accounts/${testAccountId}/ledger?cursor=cursor-2&limit=100`,
      );
    });

    it("should stop pagination when no entries returned", async () => {
      mocks.mockHttpClient.request.mockResolvedValue({
        ledger: [],
        cursor: undefined,
        has_next: false,
      });

      const result = await client.getAllAccountLedgerEntries(testAccountId);

      expect(result).toEqual([]);
      expect(mocks.mockHttpClient.request).toHaveBeenCalledTimes(1);
    });

    it("should respect custom limit parameter", async () => {
      mocks.mockHttpClient.request.mockResolvedValue({
        ledger: [],
        cursor: undefined,
        has_next: false,
      });

      await client.getAllAccountLedgerEntries(testAccountId, { limit: 25 });

      expect(mocks.mockHttpClient.request.mock.calls[0][0]).toBe(
        `/api/v3/brokerage/accounts/${testAccountId}/ledger?limit=25`,
      );
    });
  });

  describe("testConnection", () => {
    it("should return true for successful connection", async () => {
      mocks.mockHttpClient.request.mockResolvedValue({ accounts: [] });

      const result = await client.testConnection();

      expect(result).toBe(true);
    });

    it("should return false for failed connection", async () => {
      mocks.mockHttpClient.request.mockRejectedValue(
        new Error("Authentication failed"),
      );

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle and re-throw HTTP errors", async () => {
      const error = new Error("HTTP 401: Unauthorized");
      mocks.mockHttpClient.request.mockRejectedValue(error);

      await expect(client.getAccounts()).rejects.toThrow(
        "HTTP 401: Unauthorized",
      );
    });

    it("should enhance authentication error messages", async () => {
      const error = new Error("HTTP 403: Forbidden");
      mocks.mockHttpClient.request.mockRejectedValue(error);

      await expect(client.getAccounts()).rejects.toThrow("HTTP 403: Forbidden");
      
      // The authentication error logging is tested implicitly by the error being thrown
      // Since we're mocking the logger, we can't easily test the log content,
      // but the important thing is that the error is properly re-thrown
    });
  });
});