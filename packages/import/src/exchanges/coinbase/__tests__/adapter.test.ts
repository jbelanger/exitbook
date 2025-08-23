import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Decimal } from "decimal.js";
import { CoinbaseAdapter } from "../adapter.js";
import { CoinbaseAPIClient } from "../coinbase-api-client.js";
import type {
  CoinbaseCredentials,
  RawCoinbaseAccount,
  RawCoinbaseTransaction,
} from "../types.js";
import type {
  UniversalExchangeAdapterConfig,
  UniversalFetchParams,
} from "@crypto/core";

// Mock the API client
vi.mock("../coinbase-api-client");

// Mock the logger
vi.mock("@crypto/shared-logger", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe("CoinbaseAdapter", () => {
  let mockApiClient: {
    testConnection: ReturnType<typeof vi.fn>;
    getAccounts: ReturnType<typeof vi.fn>;
    getAccountTransactions: ReturnType<typeof vi.fn>;
    getRateLimitStatus: ReturnType<typeof vi.fn>;
  };
  let adapter: CoinbaseAdapter;
  let config: UniversalExchangeAdapterConfig;
  let credentials: CoinbaseCredentials;

  beforeEach(() => {
    config = {
      type: "exchange",
      id: "coinbase",
      subType: "native",
      credentials: {
        apiKey: "test-key",
        secret: "test-secret",
        password: "test-passphrase",
      },
    };

    credentials = {
      apiKey: "test-key",
      secret: "test-secret",
      passphrase: "test-passphrase",
      sandbox: true,
    };

    // Create mock API client
    mockApiClient = {
      testConnection: vi.fn(),
      getAccounts: vi.fn(),
      getAccountTransactions: vi.fn(),
      getRateLimitStatus: vi.fn(),
    };

    // Mock the CoinbaseAPIClient constructor
    const MockedCoinbaseAPIClient = CoinbaseAPIClient as unknown as ReturnType<
      typeof vi.fn
    >;
    MockedCoinbaseAPIClient.mockImplementation(() => mockApiClient);

    adapter = new CoinbaseAdapter(config, credentials);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getInfo", () => {
    it("should return correct adapter info", async () => {
      const info = await adapter.getInfo();

      expect(info).toEqual({
        id: "coinbase",
        name: "Coinbase Track API",
        type: "exchange",
        subType: "native",
        capabilities: {
          supportedOperations: ["fetchTransactions", "fetchBalances"],
          maxBatchSize: 100,
          supportsHistoricalData: true,
          supportsPagination: true,
          requiresApiKey: true,
          rateLimit: {
            requestsPerSecond: 3,
            burstLimit: 5,
          },
        },
      });
    });
  });

  describe("testConnection", () => {
    it("should return true for successful connection", async () => {
      mockApiClient.testConnection.mockResolvedValue(true);

      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockApiClient.testConnection).toHaveBeenCalledTimes(1);
    });

    it("should return false for failed connection", async () => {
      mockApiClient.testConnection.mockResolvedValue(false);

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it("should handle connection errors gracefully", async () => {
      mockApiClient.testConnection.mockRejectedValue(
        new Error("Network error"),
      );

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });
  });

  describe("fetchTransactions", () => {
    const mockAccounts: RawCoinbaseAccount[] = [
      {
        id: "account-1",
        name: "BTC Wallet",
        primary: true,
        type: "wallet",
        currency: {
          code: "BTC",
          name: "Bitcoin",
          color: "#f7931a",
          sort_index: 0,
          exponent: 8,
          type: "crypto"
        },
        balance: { amount: "1.0", currency: "BTC" },
        created_at: "2022-01-01T00:00:00Z",
        updated_at: "2022-01-01T00:00:00Z",
        resource: "account",
        resource_path: "/v2/accounts/account-1"
      },
      {
        id: "account-2",
        name: "USD Wallet",
        primary: false,
        type: "fiat",
        currency: {
          code: "USD",
          name: "US Dollar",
          color: "#85bb65",
          sort_index: 100,
          exponent: 2,
          type: "fiat"
        },
        balance: { amount: "1000.0", currency: "USD" },
        created_at: "2022-01-01T00:00:00Z",
        updated_at: "2022-01-01T00:00:00Z",
        resource: "account",
        resource_path: "/v2/accounts/account-2"
      },
    ];

    beforeEach(() => {
      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);
    });

    it("should fetch and transform simple deposit transaction", async () => {
      const depositTransaction: RawCoinbaseTransaction = {
        id: "deposit-123",
        type: "deposit",
        status: "completed",
        amount: { amount: "100.00", currency: "USD" },
        native_amount: { amount: "100.00", currency: "USD" },
        description: "Bank deposit",
        created_at: "2022-01-01T00:00:00Z",
        updated_at: "2022-01-01T00:00:00Z",
        resource: "transaction",
        resource_path: "/v2/accounts/account-1/transactions/deposit-123",
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [depositTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["deposit"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-track-deposit-123",
        type: "deposit",
        timestamp: new Date("2022-01-01T00:00:00Z").getTime(),
        datetime: "2022-01-01T00:00:00.000Z",
        status: "closed",
        symbol: "USD",
        amount: { amount: new Decimal("100.00"), currency: "USD" },
        side: "buy",
        fee: { amount: new Decimal(0), currency: "USD" },
        source: "coinbase",
        metadata: {
          trackTransaction: depositTransaction,
          transactionType: "deposit",
          status: "completed",
          nativeAmount: { amount: "100.00", currency: "USD" },
          adapterType: "track-api",
        },
      });
    });

    it("should fetch and transform simple withdrawal transaction", async () => {
      const withdrawalTransaction: RawCoinbaseTransaction = {
        id: "withdrawal-456",
        type: "send",
        status: "completed",
        amount: { amount: "-50.00", currency: "USD" },
        native_amount: { amount: "-50.00", currency: "USD" },
        description: "Bank withdrawal",
        created_at: "2022-01-01T12:00:00Z",
        updated_at: "2022-01-01T12:00:00Z",
        resource: "transaction",
        resource_path: "/v2/accounts/account-2/transactions/withdrawal-456",
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [withdrawalTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["withdrawal"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-track-withdrawal-456",
        type: "withdrawal",
        timestamp: new Date("2022-01-01T12:00:00Z").getTime(),
        datetime: "2022-01-01T12:00:00.000Z",
        status: "closed",
        symbol: "USD",
        amount: { amount: new Decimal("50.00"), currency: "USD" },
        side: "sell",
        fee: { amount: new Decimal(0), currency: "USD" },
        source: "coinbase",
        metadata: {
          trackTransaction: withdrawalTransaction,
          transactionType: "send",
          status: "completed",
          nativeAmount: { amount: "-50.00", currency: "USD" },
          adapterType: "track-api",
        },
      });
    });

    it("should transform buy trade transaction correctly", async () => {
      const buyTransaction: RawCoinbaseTransaction = {
        id: "buy-123",
        type: "buy",
        status: "completed",
        amount: { amount: "0.01", currency: "BTC" },
        native_amount: { amount: "500.00", currency: "USD" },
        description: "Bought 0.01000000 BTC for $500.00",
        created_at: "2022-01-01T10:00:00Z",
        updated_at: "2022-01-01T10:00:00Z",
        resource: "transaction",
        resource_path: "/v2/accounts/account-1/transactions/buy-123",
        buy: {
          id: "order-123",
          resource: "buy",
          resource_path: "/v2/accounts/account-1/buys/order-123",
        },
        network: {
          status: "confirmed",
          transaction_fee: {
            amount: "2.50",
            currency: "USD",
          },
        },
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [buyTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["trade"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-track-buy-123",
        type: "trade",
        timestamp: new Date("2022-01-01T10:00:00Z").getTime(),
        datetime: "2022-01-01T10:00:00.000Z",
        status: "closed",
        symbol: "BTC",
        amount: { amount: new Decimal("0.01"), currency: "BTC" },
        side: "buy",
        fee: { amount: new Decimal("2.50"), currency: "USD" },
        source: "coinbase",
        metadata: {
          trackTransaction: buyTransaction,
          transactionType: "buy",
          status: "completed",
          nativeAmount: { amount: "500.00", currency: "USD" },
          adapterType: "track-api",
        },
      });
    });

    it("should handle sell trades correctly", async () => {
      const sellTransaction: RawCoinbaseTransaction = {
        id: "sell-789",
        type: "sell",
        status: "completed",
        amount: { amount: "-0.005", currency: "BTC" },
        native_amount: { amount: "250.00", currency: "USD" },
        description: "Sold 0.00500000 BTC for $250.00",
        created_at: "2022-01-02T15:30:00Z",
        updated_at: "2022-01-02T15:30:00Z",
        resource: "transaction",
        resource_path: "/v2/accounts/account-1/transactions/sell-789",
        sell: {
          id: "order-789",
          resource: "sell",
          resource_path: "/v2/accounts/account-1/sells/order-789",
        },
      };

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: [sellTransaction], pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["trade"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-track-sell-789",
        type: "trade",
        timestamp: new Date("2022-01-02T15:30:00Z").getTime(),
        datetime: "2022-01-02T15:30:00.000Z",
        status: "closed",
        symbol: "BTC",
        amount: { amount: new Decimal("0.005"), currency: "BTC" },
        side: "sell",
        fee: { amount: new Decimal(0), currency: "BTC" },
        source: "coinbase",
        metadata: {
          trackTransaction: sellTransaction,
          transactionType: "sell",
          status: "completed",
          nativeAmount: { amount: "250.00", currency: "USD" },
          adapterType: "track-api",
        },
      });
    });

    it("should filter transactions by requested types", async () => {
      const mixedTransactions: RawCoinbaseTransaction[] = [
        {
          id: "deposit-1",
          type: "deposit",
          status: "completed",
          amount: { amount: "100.00", currency: "USD" },
          native_amount: { amount: "100.00", currency: "USD" },
          description: "Bank deposit",
          created_at: "2022-01-01T00:00:00Z",
          updated_at: "2022-01-01T00:00:00Z",
          resource: "transaction",
          resource_path: "/v2/accounts/account-1/transactions/deposit-1",
        },
        {
          id: "withdrawal-1",
          type: "send",
          status: "completed",
          amount: { amount: "-50.00", currency: "USD" },
          native_amount: { amount: "-50.00", currency: "USD" },
          description: "Bank withdrawal",
          created_at: "2022-01-01T01:00:00Z",
          updated_at: "2022-01-01T01:00:00Z",
          resource: "transaction",
          resource_path: "/v2/accounts/account-1/transactions/withdrawal-1",
        },
      ];

      mockApiClient.getAccountTransactions
        .mockResolvedValueOnce({ data: mixedTransactions, pagination: {} }) // First account
        .mockResolvedValueOnce({ data: [], pagination: {} }); // Second account (empty)

      // Request only deposits
      const params: UniversalFetchParams = { transactionTypes: ["deposit"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0].type).toBe("deposit");
    });

    it("should handle account loading errors gracefully", async () => {
      mockApiClient.getAccounts.mockRejectedValue(new Error("API Error"));

      const params: UniversalFetchParams = { transactionTypes: ["trade"] };

      await expect(adapter.fetchTransactions(params)).rejects.toThrow(
        "API Error",
      );
    });

    it("should continue processing other accounts when one fails", async () => {
      mockApiClient.getAccountTransactions
        .mockRejectedValueOnce(new Error("Account 1 failed"))
        .mockResolvedValueOnce({
          data: [
            {
              id: "entry-1",
              type: "deposit",
              status: "completed",
              amount: { amount: "100.00", currency: "USD" },
              native_amount: { amount: "100.00", currency: "USD" },
              description: "Bank deposit",
              created_at: "2022-01-01T00:00:00Z",
              updated_at: "2022-01-01T00:00:00Z",
              resource: "transaction",
              resource_path: "/v2/accounts/account-2/transactions/entry-1",
            },
          ],
          pagination: {},
        });

      const params: UniversalFetchParams = { transactionTypes: ["deposit"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(mockApiClient.getAccountTransactions).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchBalances", () => {
    it("should transform account balances correctly", async () => {
      const mockAccounts: RawCoinbaseAccount[] = [
        {
          id: "account-1",
          name: "BTC Wallet",
          primary: true,
          type: "wallet",
          currency: {
            code: "BTC",
            name: "Bitcoin",
            color: "#f7931a",
            sort_index: 0,
            exponent: 8,
            type: "crypto"
          },
          balance: { amount: "1.5", currency: "BTC" },
          created_at: "2022-01-01T00:00:00Z",
          updated_at: "2022-01-01T00:00:00Z",
          resource: "account",
          resource_path: "/v2/accounts/account-1"
        },
        {
          id: "account-2",
          name: "USD Wallet",
          primary: false,
          type: "fiat",
          currency: {
            code: "USD",
            name: "US Dollar",
            color: "#85bb65",
            sort_index: 100,
            exponent: 2,
            type: "fiat"
          },
          balance: { amount: "1000.00", currency: "USD" },
          created_at: "2022-01-01T00:00:00Z",
          updated_at: "2022-01-01T00:00:00Z",
          resource: "account",
          resource_path: "/v2/accounts/account-2"
        },
      ];

      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);

      const balances = await adapter.fetchBalances({});

      expect(balances).toHaveLength(2);

      expect(balances[0]).toEqual({
        currency: "BTC",
        free: 1.5,
        used: 0,
        total: 1.5,
      });

      expect(balances[1]).toEqual({
        currency: "USD",
        free: 1000.0,
        used: 0,
        total: 1000.0,
      });
    });

    it("should exclude zero-balance accounts", async () => {
      const mockAccounts: RawCoinbaseAccount[] = [
        {
          id: "account-1",
          name: "BTC Wallet",
          primary: true,
          type: "wallet",
          currency: {
            code: "BTC",
            name: "Bitcoin",
            color: "#f7931a",
            sort_index: 0,
            exponent: 8,
            type: "crypto"
          },
          balance: { amount: "0", currency: "BTC" },
          created_at: "2022-01-01T00:00:00Z",
          updated_at: "2022-01-01T00:00:00Z",
          resource: "account",
          resource_path: "/v2/accounts/account-1"
        },
        {
          id: "account-2",
          name: "USD Wallet",
          primary: false,
          type: "fiat",
          currency: {
            code: "USD",
            name: "US Dollar",
            color: "#85bb65",
            sort_index: 100,
            exponent: 2,
            type: "fiat"
          },
          balance: { amount: "100.00", currency: "USD" },
          created_at: "2022-01-01T00:00:00Z",
          updated_at: "2022-01-01T00:00:00Z",
          resource: "account",
          resource_path: "/v2/accounts/account-2"
        },
      ];

      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);

      const balances = await adapter.fetchBalances({});

      expect(balances).toHaveLength(1);
      expect(balances[0].currency).toBe("USD");
    });
  });
});
