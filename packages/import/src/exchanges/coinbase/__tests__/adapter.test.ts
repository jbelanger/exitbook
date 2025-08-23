import { describe, it, expect, beforeEach, vi } from "vitest";
import { Decimal } from "decimal.js";
import { CoinbaseAdapter } from "../adapter";
import { CoinbaseAPIClient } from "../coinbase-api-client";
import type {
  CoinbaseCredentials,
  RawCoinbaseAccount,
  RawCoinbaseLedgerEntry,
} from "../types";
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
  let mockApiClient: vi.Mocked<CoinbaseAPIClient>;
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
      getAllAccountLedgerEntries: vi.fn(),
      getRateLimitStatus: vi.fn(),
    } as unknown as CoinbaseAPIClient;

    (
      CoinbaseAPIClient as vi.MockedClass<typeof CoinbaseAPIClient>
    ).mockImplementation(() => mockApiClient);

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
        name: "Coinbase Advanced Trade",
        type: "exchange",
        subType: "native",
        capabilities: {
          supportedOperations: ["fetchTransactions", "fetchBalances"],
          maxBatchSize: 100,
          supportsHistoricalData: true,
          supportsPagination: true,
          requiresApiKey: true,
          rateLimit: {
            requestsPerSecond: 10,
            burstLimit: 15,
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
        uuid: "account-1",
        name: "BTC Wallet",
        currency: "BTC",
        available_balance: { value: "1.0", currency: "BTC" },
        default: true,
        active: true,
        type: "wallet",
      },
      {
        uuid: "account-2",
        name: "USD Wallet",
        currency: "USD",
        available_balance: { value: "1000.0", currency: "USD" },
        default: false,
        active: true,
        type: "fiat",
      },
    ];

    beforeEach(() => {
      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);
    });

    it("should fetch and transform simple deposit transaction", async () => {
      const depositEntry: RawCoinbaseLedgerEntry = {
        id: "deposit-123",
        created_at: "2022-01-01T00:00:00Z",
        amount: { value: "100.00", currency: "USD" },
        type: "DEPOSIT",
        direction: "CREDIT",
        details: {
          payment_method: { id: "pm-1", type: "bank_account" },
        },
      };

      mockApiClient.getAllAccountLedgerEntries
        .mockResolvedValueOnce([depositEntry]) // First account
        .mockResolvedValueOnce([]); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["deposit"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-deposit-123",
        type: "deposit",
        timestamp: new Date("2022-01-01T00:00:00Z").getTime(),
        datetime: "2022-01-01T00:00:00.000Z",
        status: "closed",
        symbol: undefined,
        amount: { amount: new Decimal("100.00"), currency: "USD" },
        side: "buy",
        fee: undefined,
        source: "coinbase",
        metadata: {
          ledgerEntryId: "deposit-123",
          ledgerType: "DEPOSIT",
          direction: "CREDIT",
          details: { payment_method: { id: "pm-1", type: "bank_account" } },
          adapterType: "native",
        },
      });
    });

    it("should fetch and transform simple withdrawal transaction", async () => {
      const withdrawalEntry: RawCoinbaseLedgerEntry = {
        id: "withdrawal-456",
        created_at: "2022-01-01T12:00:00Z",
        amount: { value: "-50.00", currency: "USD" },
        type: "WITHDRAWAL",
        direction: "DEBIT",
        details: {
          payment_method: { id: "pm-2", type: "bank_account" },
        },
      };

      mockApiClient.getAllAccountLedgerEntries
        .mockResolvedValueOnce([withdrawalEntry]) // First account
        .mockResolvedValueOnce([]); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["withdrawal"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-withdrawal-456",
        type: "withdrawal",
        timestamp: new Date("2022-01-01T12:00:00Z").getTime(),
        datetime: "2022-01-01T12:00:00.000Z",
        status: "closed",
        symbol: undefined,
        amount: { amount: new Decimal("50.00"), currency: "USD" },
        side: "sell",
        fee: undefined,
        source: "coinbase",
        metadata: {
          ledgerEntryId: "withdrawal-456",
          ledgerType: "WITHDRAWAL",
          direction: "DEBIT",
          details: { payment_method: { id: "pm-2", type: "bank_account" } },
          adapterType: "native",
        },
      });
    });

    it("should group and transform trade transactions correctly", async () => {
      // Simulate a BTC buy order with multiple ledger entries
      const tradeEntries: RawCoinbaseLedgerEntry[] = [
        // BTC received (credit)
        {
          id: "trade-1-btc",
          created_at: "2022-01-01T10:00:00Z",
          amount: { value: "0.01", currency: "BTC" },
          type: "TRADE_FILL",
          direction: "CREDIT",
          details: {
            order_id: "order-123",
            trade_id: "trade-456",
            product_id: "BTC-USD",
            order_side: "BUY",
          },
        },
        // USD spent (debit)
        {
          id: "trade-1-usd",
          created_at: "2022-01-01T10:00:00Z",
          amount: { value: "-500.00", currency: "USD" },
          type: "TRADE_FILL",
          direction: "DEBIT",
          details: {
            order_id: "order-123",
            trade_id: "trade-456",
            product_id: "BTC-USD",
            order_side: "BUY",
          },
        },
        // Fee (debit)
        {
          id: "trade-1-fee",
          created_at: "2022-01-01T10:00:00Z",
          amount: { value: "-2.50", currency: "USD" },
          type: "FEE",
          direction: "DEBIT",
          details: {
            order_id: "order-123",
            fee: { value: "2.50", currency: "USD" },
          },
        },
      ];

      mockApiClient.getAllAccountLedgerEntries
        .mockResolvedValueOnce(tradeEntries) // First account
        .mockResolvedValueOnce([]); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["trade"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-trade-order-123",
        type: "trade",
        timestamp: new Date("2022-01-01T10:00:00Z").getTime(),
        datetime: "2022-01-01T10:00:00.000Z",
        status: "closed",
        symbol: "BTC-USD",
        amount: { amount: new Decimal("0.01"), currency: "BTC" },
        side: "buy",
        price: { amount: new Decimal("500.00"), currency: "USD" },
        fee: { amount: new Decimal("2.50"), currency: "USD" },
        source: "coinbase",
        metadata: {
          orderId: "order-123",
          entries: [
            { id: "trade-1-btc", type: "TRADE_FILL", direction: "CREDIT" },
            { id: "trade-1-usd", type: "TRADE_FILL", direction: "DEBIT" },
            { id: "trade-1-fee", type: "FEE", direction: "DEBIT" },
          ],
          adapterType: "native",
        },
      });
    });

    it("should handle sell trades correctly", async () => {
      const sellTradeEntries: RawCoinbaseLedgerEntry[] = [
        // BTC sold (debit)
        {
          id: "sell-1-btc",
          created_at: "2022-01-02T15:30:00Z",
          amount: { value: "-0.005", currency: "BTC" },
          type: "TRADE_FILL",
          direction: "DEBIT",
          details: {
            order_id: "order-789",
            product_id: "BTC-USD",
            order_side: "SELL",
          },
        },
        // USD received (credit)
        {
          id: "sell-1-usd",
          created_at: "2022-01-02T15:30:00Z",
          amount: { value: "250.00", currency: "USD" },
          type: "TRADE_FILL",
          direction: "CREDIT",
          details: {
            order_id: "order-789",
            product_id: "BTC-USD",
            order_side: "SELL",
          },
        },
      ];

      mockApiClient.getAllAccountLedgerEntries
        .mockResolvedValueOnce(sellTradeEntries) // First account
        .mockResolvedValueOnce([]); // Second account (empty)

      const params: UniversalFetchParams = { transactionTypes: ["trade"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toEqual({
        id: "coinbase-trade-order-789",
        type: "trade",
        timestamp: new Date("2022-01-02T15:30:00Z").getTime(),
        datetime: "2022-01-02T15:30:00.000Z",
        status: "closed",
        symbol: "BTC-USD",
        amount: { amount: new Decimal("0.005"), currency: "BTC" },
        side: "sell",
        price: { amount: new Decimal("250.00"), currency: "USD" },
        fee: undefined,
        source: "coinbase",
        metadata: {
          orderId: "order-789",
          entries: [
            { id: "sell-1-btc", type: "TRADE_FILL", direction: "DEBIT" },
            { id: "sell-1-usd", type: "TRADE_FILL", direction: "CREDIT" },
          ],
          adapterType: "native",
        },
      });
    });

    it("should filter transactions by requested types", async () => {
      const mixedEntries: RawCoinbaseLedgerEntry[] = [
        {
          id: "deposit-1",
          created_at: "2022-01-01T00:00:00Z",
          amount: { value: "100.00", currency: "USD" },
          type: "DEPOSIT",
          direction: "CREDIT",
          details: {},
        },
        {
          id: "withdrawal-1",
          created_at: "2022-01-01T01:00:00Z",
          amount: { value: "-50.00", currency: "USD" },
          type: "WITHDRAWAL",
          direction: "DEBIT",
          details: {},
        },
      ];

      mockApiClient.getAllAccountLedgerEntries
        .mockResolvedValueOnce(mixedEntries) // First account
        .mockResolvedValueOnce([]); // Second account (empty)

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
      mockApiClient.getAllAccountLedgerEntries
        .mockRejectedValueOnce(new Error("Account 1 failed"))
        .mockResolvedValueOnce([
          {
            id: "entry-1",
            created_at: "2022-01-01T00:00:00Z",
            amount: { value: "100.00", currency: "USD" },
            type: "DEPOSIT",
            direction: "CREDIT",
            details: {},
          },
        ]);

      const params: UniversalFetchParams = { transactionTypes: ["deposit"] };
      const transactions = await adapter.fetchTransactions(params);

      expect(transactions).toHaveLength(1);
      expect(mockApiClient.getAllAccountLedgerEntries).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchBalances", () => {
    it("should transform account balances correctly", async () => {
      const mockAccounts: RawCoinbaseAccount[] = [
        {
          uuid: "account-1",
          name: "BTC Wallet",
          currency: "BTC",
          available_balance: { value: "1.5", currency: "BTC" },
          hold: { value: "0.1", currency: "BTC" },
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

      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);

      const balances = await adapter.fetchBalances({});

      expect(balances).toHaveLength(2);

      expect(balances[0]).toEqual({
        currency: "BTC",
        free: 1.5,
        used: 0.1,
        total: 1.6,
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
          uuid: "account-1",
          name: "BTC Wallet",
          currency: "BTC",
          available_balance: { value: "0", currency: "BTC" },
          default: true,
          active: true,
          type: "wallet",
        },
        {
          uuid: "account-2",
          name: "USD Wallet",
          currency: "USD",
          available_balance: { value: "100.00", currency: "USD" },
          default: false,
          active: true,
          type: "fiat",
        },
      ];

      mockApiClient.getAccounts.mockResolvedValue(mockAccounts);

      const balances = await adapter.fetchBalances({});

      expect(balances).toHaveLength(1);
      expect(balances[0].currency).toBe("USD");
    });
  });
});
