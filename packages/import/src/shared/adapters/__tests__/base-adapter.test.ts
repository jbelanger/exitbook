import { describe, it, expect, beforeEach, vi } from "vitest";
import { Decimal } from "decimal.js";
import type {
  UniversalAdapterInfo,
  UniversalFetchParams,
  UniversalTransaction,
  UniversalBalance,
  UniversalAdapterConfig,
  TransactionType,
  TransactionStatus,
} from "@crypto/core";
import { BaseAdapter } from "../base-adapter.ts";

// Mock logger
const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

vi.mock("@crypto/shared-logger", () => ({
  getLogger: () => mockLogger,
}));

// Test implementation of BaseAdapter
class TestAdapter extends BaseAdapter {
  private mockRawTransactions: unknown[] = [];
  private mockRawBalances: unknown[] = [];
  private mockTransactions: UniversalTransaction[] = [];
  private mockBalances: UniversalBalance[] = [];

  constructor(config: UniversalAdapterConfig) {
    super(config);
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: "test-adapter",
      name: "Test Adapter",
      type: "exchange",
      capabilities: {
        supportedOperations: ["fetchTransactions", "fetchBalances"],
        maxBatchSize: 100,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: false,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    return true;
  }

  protected async fetchRawTransactions(): Promise<unknown> {
    return this.mockRawTransactions;
  }

  protected async fetchRawBalances(): Promise<unknown> {
    return this.mockRawBalances;
  }

  protected async transformTransactions(): Promise<UniversalTransaction[]> {
    return this.mockTransactions;
  }

  protected async transformBalances(): Promise<UniversalBalance[]> {
    return this.mockBalances;
  }

  // Test helpers
  setMockTransactions(transactions: UniversalTransaction[]) {
    this.mockTransactions = transactions;
  }

  setMockBalances(balances: UniversalBalance[]) {
    this.mockBalances = balances;
  }
}

describe("BaseAdapter Validation Integration", () => {
  let adapter: TestAdapter;
  const mockConfig: UniversalAdapterConfig = {
    type: "exchange",
    id: "test",
    subType: "ccxt",
  };

  const validTransaction: UniversalTransaction = {
    id: "tx_valid",
    timestamp: 1640995200000,
    datetime: "2022-01-01T00:00:00.000Z",
    type: "trade" as TransactionType,
    status: "closed" as TransactionStatus,
    amount: {
      amount: new Decimal("100.50"),
      currency: "BTC",
    },
    source: "test",
    metadata: { test: true },
  };

  beforeEach(() => {
    adapter = new TestAdapter(mockConfig);
    vi.clearAllMocks();
  });

  describe("fetchTransactions with validation", () => {
    const invalidTransaction = {
      id: "tx_invalid",
      // Missing required fields
      timestamp: "invalid_timestamp", // Should be number
      type: "invalid_type", // Invalid enum value
      source: "", // Empty string
    } as unknown as UniversalTransaction;

    it("should process all valid transactions successfully", async () => {
      adapter.setMockTransactions([validTransaction]);

      const result = await adapter.fetchTransactions({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(validTransaction);
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Validation completed: 1 valid, 0 invalid"),
      );
    });

    it("should filter out invalid transactions and log errors", async () => {
      adapter.setMockTransactions([validTransaction, invalidTransaction]);

      const result = await adapter.fetchTransactions({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(validTransaction);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("1 invalid transactions from TestAdapter"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Validation completed: 1 valid, 1 invalid"),
      );
    });

    it("should handle all invalid transactions gracefully", async () => {
      adapter.setMockTransactions([invalidTransaction]);

      const result = await adapter.fetchTransactions({});

      expect(result).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("1 invalid transactions from TestAdapter"),
      );
    });

    it("should provide detailed error information in logs", async () => {
      adapter.setMockTransactions([invalidTransaction]);

      await adapter.fetchTransactions({});

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(
          /TestAdapter.*Invalid: 1.*Valid: 0.*Total: 1.*Errors:/,
        ),
      );

      const logCall = mockLogger.error.mock.calls[0][0] as string;
      expect(logCall).toContain("timestamp:");
      expect(logCall).toContain("type:");
      expect(logCall).toContain("source:");
    });

    it("should apply filters to validated transactions only", async () => {
      const btcTransaction = { ...validTransaction, id: "btc_tx" };
      const ethTransaction = {
        ...validTransaction,
        id: "eth_tx",
        amount: { amount: new Decimal("10"), currency: "ETH" },
      };

      adapter.setMockTransactions([
        btcTransaction,
        ethTransaction,
        invalidTransaction,
      ]);

      const result = await adapter.fetchTransactions({ symbols: ["BTC"] });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("btc_tx");
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Validation completed: 2 valid, 1 invalid"),
      );
    });

    it("should sort validated transactions by timestamp descending", async () => {
      const oldTransaction = {
        ...validTransaction,
        id: "old",
        timestamp: 1000000,
      };
      const newTransaction = {
        ...validTransaction,
        id: "new",
        timestamp: 2000000,
      };

      adapter.setMockTransactions([oldTransaction, newTransaction]);

      const result = await adapter.fetchTransactions({});

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("new"); // Newer transaction first
      expect(result[1].id).toBe("old");
    });
  });

  describe("fetchBalances with validation", () => {
    const validBalance: UniversalBalance = {
      currency: "BTC",
      total: 1.5,
      free: 1.2,
      used: 0.3,
    };

    const invalidBalance = {
      currency: "", // Empty currency
      total: -1, // Negative total
      free: 0.8,
      used: 0.2,
    } as UniversalBalance;

    it("should process all valid balances successfully", async () => {
      adapter.setMockBalances([validBalance]);

      const result = await adapter.fetchBalances({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(validBalance);
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          "Balance validation completed: 1 valid, 0 invalid",
        ),
      );
    });

    it("should filter out invalid balances and log errors", async () => {
      adapter.setMockBalances([validBalance, invalidBalance]);

      const result = await adapter.fetchBalances({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(validBalance);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("1 invalid balances from TestAdapter"),
      );
    });

    it("should handle all invalid balances gracefully", async () => {
      adapter.setMockBalances([invalidBalance]);

      const result = await adapter.fetchBalances({});

      expect(result).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("1 invalid balances from TestAdapter"),
      );
    });

    it("should validate complex balance constraints", async () => {
      const invalidConstraintBalance: UniversalBalance = {
        currency: "BTC",
        total: 1.0,
        free: 0.8,
        used: 0.5, // total (1.0) < free + used (1.3)
      };

      adapter.setMockBalances([invalidConstraintBalance]);

      const result = await adapter.fetchBalances({});

      expect(result).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
      const logCall = mockLogger.error.mock.calls[0][0] as string;
      expect(logCall).toContain("Total balance must be >= free + used");
    });
  });

  describe("Performance and edge cases", () => {
    it("should handle large batches efficiently", async () => {
      const largeTransactionBatch: UniversalTransaction[] = Array.from(
        { length: 1000 },
        (_, i) => ({
          id: `tx_${i}`,
          timestamp: 1640995200000 + i,
          datetime: "2022-01-01T00:00:00.000Z",
          type: "trade" as TransactionType,
          status: "closed" as TransactionStatus,
          amount: {
            amount: new Decimal("100"),
            currency: "BTC",
          },
          source: "test",
          metadata: {},
        }),
      );

      adapter.setMockTransactions(largeTransactionBatch);

      const start = Date.now();
      const result = await adapter.fetchTransactions({});
      const duration = Date.now() - start;

      expect(result).toHaveLength(1000);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Validation completed: 1000 valid, 0 invalid"),
      );
    });

    it("should handle empty transaction arrays", async () => {
      adapter.setMockTransactions([]);

      const result = await adapter.fetchTransactions({});

      expect(result).toHaveLength(0);
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Validation completed: 0 valid, 0 invalid"),
      );
    });

    it("should handle mixed valid/invalid in large batches", async () => {
      const mixedBatch = Array.from({ length: 100 }, (_, i) => {
        if (i % 10 === 0) {
          // Every 10th transaction is invalid
          return { id: `invalid_${i}`, invalid: true };
        }
        return {
          id: `valid_${i}`,
          timestamp: 1640995200000 + i,
          datetime: "2022-01-01T00:00:00.000Z",
          type: "trade" as TransactionType,
          status: "closed" as TransactionStatus,
          amount: {
            amount: new Decimal("100"),
            currency: "BTC",
          },
          source: "test",
          metadata: {},
        };
      });

      adapter.setMockTransactions(mixedBatch as UniversalTransaction[]);

      const result = await adapter.fetchTransactions({});

      expect(result).toHaveLength(90); // 90 valid out of 100
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("10 invalid transactions from TestAdapter"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Validation completed: 90 valid, 10 invalid"),
      );
    });
  });

  describe("Integration with existing adapter features", () => {
    it("should validate params before processing", async () => {
      const invalidParams: UniversalFetchParams = {
        since: 2000000,
        until: 1000000, // since > until
      };

      await expect(adapter.fetchTransactions(invalidParams)).rejects.toThrow(
        "since cannot be greater than until",
      );

      // Should not reach validation stage
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it("should maintain existing filter functionality after validation", async () => {
      const tradeTransaction: UniversalTransaction = {
        ...validTransaction,
        id: "trade_tx",
        type: "trade" as TransactionType,
      };
      const depositTransaction: UniversalTransaction = {
        ...validTransaction,
        id: "deposit_tx",
        type: "deposit" as TransactionType,
      };

      adapter.setMockTransactions([tradeTransaction, depositTransaction]);

      const result = await adapter.fetchTransactions({
        transactionTypes: ["trade"],
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("trade");
    });
  });
});
