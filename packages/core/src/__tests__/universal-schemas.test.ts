import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import type { ZodIssue } from "zod";
import {
  UniversalTransactionSchema,
  UniversalBalanceSchema,
  MoneySchema,
  validateUniversalTransaction,
  validateUniversalTransactions,
  validateUniversalBalances,
} from "../validation/universal-schemas.js";

describe("Universal Schemas Validation", () => {
  describe("MoneySchema", () => {
    it("should validate valid money objects", () => {
      const validMoney = {
        amount: new Decimal("123.456"),
        currency: "USD",
      };

      const result = MoneySchema.safeParse(validMoney);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validMoney);
      }
    });

    it("should reject money with invalid amount type", () => {
      const invalidMoney = {
        amount: 123.456, // Should be Decimal instance
        currency: "USD",
      };

      const result = MoneySchema.safeParse(invalidMoney);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Expected Decimal instance",
        );
      }
    });

    it("should reject money with empty currency", () => {
      const invalidMoney = {
        amount: new Decimal("123.456"),
        currency: "", // Empty string
      };

      const result = MoneySchema.safeParse(invalidMoney);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Currency must not be empty",
        );
      }
    });
  });

  describe("UniversalTransactionSchema", () => {
    const validTransaction = {
      id: "tx_123",
      timestamp: 1640995200000, // 2022-01-01 00:00:00 UTC
      datetime: "2022-01-01T00:00:00.000Z",
      type: "trade",
      status: "closed",
      amount: {
        amount: new Decimal("100.50"),
        currency: "BTC",
      },
      source: "coinbase",
      metadata: { test: true },
    };

    it("should validate valid universal transaction", () => {
      const result = UniversalTransactionSchema.safeParse(validTransaction);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe("tx_123");
        expect(result.data.type).toBe("trade");
        expect(result.data.source).toBe("coinbase");
      }
    });

    it("should validate transaction with all optional fields", () => {
      const fullTransaction = {
        ...validTransaction,
        fee: {
          amount: new Decimal("0.001"),
          currency: "BTC",
        },
        price: {
          amount: new Decimal("45000"),
          currency: "USD",
        },
        from: "address1",
        to: "address2",
        symbol: "BTC/USD",
        network: "mainnet",
      };

      const result = UniversalTransactionSchema.safeParse(fullTransaction);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fee?.currency).toBe("BTC");
        expect(result.data.price?.currency).toBe("USD");
        expect(result.data.network).toBe("mainnet");
      }
    });

    it("should reject transaction with missing required fields", () => {
      const invalidTransaction = {
        id: "tx_123",
        // Missing timestamp, datetime, type, status, amount, source, metadata
      };

      const result = UniversalTransactionSchema.safeParse(invalidTransaction);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(
          result.error.issues.some((issue: ZodIssue) =>
            issue.path.includes("timestamp"),
          ),
        ).toBe(true);
        expect(
          result.error.issues.some((issue: ZodIssue) =>
            issue.path.includes("type"),
          ),
        ).toBe(true);
      }
    });

    it("should reject transaction with invalid transaction type", () => {
      const invalidTransaction = {
        ...validTransaction,
        type: "invalid_type",
      };

      const result = UniversalTransactionSchema.safeParse(invalidTransaction);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("type");
      }
    });

    it("should reject transaction with invalid status", () => {
      const invalidTransaction = {
        ...validTransaction,
        status: "unknown_status",
      };

      const result = UniversalTransactionSchema.safeParse(invalidTransaction);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("status");
      }
    });

    it("should reject transaction with negative timestamp", () => {
      const invalidTransaction = {
        ...validTransaction,
        timestamp: -1,
      };

      const result = UniversalTransactionSchema.safeParse(invalidTransaction);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("positive integer");
      }
    });

    it("should reject transaction with unknown properties (strict mode)", () => {
      const transactionWithExtra = {
        ...validTransaction,
        unknownField: "should be rejected",
      };

      const result = UniversalTransactionSchema.safeParse(transactionWithExtra);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe("unrecognized_keys");
      }
    });

    it("should provide default empty object for metadata", () => {
      const transactionWithoutMetadataField = { ...validTransaction };
      // Remove metadata field to test default behavior
      const transactionRecord = transactionWithoutMetadataField as Record<string, unknown>;
      delete transactionRecord.metadata;

      const result = UniversalTransactionSchema.safeParse(
        transactionWithoutMetadataField,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toEqual({});
      }
    });
  });

  describe("UniversalBalanceSchema", () => {
    const validBalance = {
      currency: "BTC",
      total: 1.5,
      free: 1.2,
      used: 0.3,
    };

    it("should validate valid universal balance", () => {
      const result = UniversalBalanceSchema.safeParse(validBalance);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe("BTC");
        expect(result.data.total).toBe(1.5);
      }
    });

    it("should validate balance with contract address", () => {
      const balanceWithContract = {
        ...validBalance,
        contractAddress: "0x123abc...",
      };

      const result = UniversalBalanceSchema.safeParse(balanceWithContract);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contractAddress).toBe("0x123abc...");
      }
    });

    it("should reject balance with negative values", () => {
      const invalidBalance = {
        ...validBalance,
        free: -0.1,
      };

      const result = UniversalBalanceSchema.safeParse(invalidBalance);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("non-negative");
      }
    });

    it("should reject balance where total < free + used", () => {
      const invalidBalance = {
        currency: "BTC",
        total: 1.0,
        free: 0.8,
        used: 0.5, // 0.8 + 0.5 = 1.3 > 1.0
      };

      const result = UniversalBalanceSchema.safeParse(invalidBalance);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Total balance must be >= free + used",
        );
      }
    });

    it("should reject balance with empty currency", () => {
      const invalidBalance = {
        ...validBalance,
        currency: "",
      };

      const result = UniversalBalanceSchema.safeParse(invalidBalance);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Currency must not be empty",
        );
      }
    });
  });

  describe("Validation Helper Functions", () => {
    describe("validateUniversalTransaction", () => {
      it("should return success for valid transaction", () => {
        const validTx = {
          id: "tx_123",
          timestamp: 1640995200000,
          datetime: "2022-01-01T00:00:00.000Z",
          type: "trade",
          status: "closed",
          amount: { amount: new Decimal("100"), currency: "BTC" },
          source: "coinbase",
          metadata: {},
        };

        const result = validateUniversalTransaction(validTx);
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.errors).toBeUndefined();
      });

      it("should return error for invalid transaction", () => {
        const invalidTx = { id: "invalid" };

        const result = validateUniversalTransaction(invalidTx);
        expect(result.success).toBe(false);
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
      });
    });

    describe("validateUniversalTransactions (batch)", () => {
      it("should separate valid and invalid transactions", () => {
        const validTx = {
          id: "tx_valid",
          timestamp: 1640995200000,
          datetime: "2022-01-01T00:00:00.000Z",
          type: "trade",
          status: "closed",
          amount: { amount: new Decimal("100"), currency: "BTC" },
          source: "coinbase",
          metadata: {},
        };

        const invalidTx = { id: "tx_invalid" };

        const result = validateUniversalTransactions([validTx, invalidTx]);

        expect(result.valid).toHaveLength(1);
        expect(result.invalid).toHaveLength(1);
        expect(result.valid[0].id).toBe("tx_valid");
        expect(result.invalid[0].data).toEqual(invalidTx);
        expect(result.invalid[0].errors).toBeDefined();
      });

      it("should handle empty array", () => {
        const result = validateUniversalTransactions([]);
        expect(result.valid).toHaveLength(0);
        expect(result.invalid).toHaveLength(0);
      });
    });

    describe("validateUniversalBalances (batch)", () => {
      it("should separate valid and invalid balances", () => {
        const validBalance = {
          currency: "BTC",
          total: 1.0,
          free: 0.8,
          used: 0.2,
        };

        const invalidBalance = { currency: "" }; // Empty currency

        const result = validateUniversalBalances([
          validBalance,
          invalidBalance,
        ]);

        expect(result.valid).toHaveLength(1);
        expect(result.invalid).toHaveLength(1);
        expect(result.valid[0].currency).toBe("BTC");
        expect(result.invalid[0].data).toEqual(invalidBalance);
      });
    });
  });

  describe("Edge Cases and Performance", () => {
    it("should handle very large numbers in Decimal", () => {
      const largeTransaction = {
        id: "tx_large",
        timestamp: 1640995200000,
        datetime: "2022-01-01T00:00:00.000Z",
        type: "trade",
        status: "closed",
        amount: {
          amount: new Decimal("999999999999999999.123456789"),
          currency: "BTC",
        },
        source: "test",
        metadata: {},
      };

      const result = UniversalTransactionSchema.safeParse(largeTransaction);
      expect(result.success).toBe(true);
    });

    it("should handle very small numbers in Decimal", () => {
      const smallTransaction = {
        id: "tx_small",
        timestamp: 1640995200000,
        datetime: "2022-01-01T00:00:00.000Z",
        type: "trade",
        status: "closed",
        amount: {
          amount: new Decimal("0.000000000000000001"),
          currency: "BTC",
        },
        source: "test",
        metadata: {},
      };

      const result = UniversalTransactionSchema.safeParse(smallTransaction);
      expect(result.success).toBe(true);
    });

    it("should validate batch of 1000 transactions within reasonable time", () => {
      const transactions = Array.from({ length: 1000 }, (_, i) => ({
        id: `tx_${i}`,
        timestamp: 1640995200000 + i,
        datetime: "2022-01-01T00:00:00.000Z",
        type: "trade",
        status: "closed",
        amount: {
          amount: new Decimal("100"),
          currency: "BTC",
        },
        source: "test",
        metadata: {},
      }));

      const start = Date.now();
      const result = validateUniversalTransactions(transactions);
      const duration = Date.now() - start;

      expect(result.valid).toHaveLength(1000);
      expect(result.invalid).toHaveLength(0);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});
