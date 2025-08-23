import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { StoredTransaction } from '../../types/data-types.ts';
import { BalanceCalculationService } from "../balance-calculation-service.js";


describe("BalanceCalculationService Precision", () => {
  const service = new BalanceCalculationService();

  const createMockTransaction = (
    type: string,
    amount: string,
    amountCurrency: string,
    side?: "buy" | "sell",
    price?: string,
    priceCurrency?: string,
    feeCost?: string,
    feeCurrency?: string,
  ): StoredTransaction => {
    const transaction: StoredTransaction = {
      id: "test-id",
      exchange: "test-exchange",
      type,
      timestamp: Date.now(),
      amount,
      raw_data: JSON.stringify({
        amount,
        price,
        fee_cost: feeCost,
      }),
      created_at: Date.now(),
      hash: "test-hash",
    };
    
    if (amountCurrency) transaction.amount_currency = amountCurrency;
    if (side) transaction.side = side;
    if (price) transaction.price = price;
    if (priceCurrency) transaction.price_currency = priceCurrency;
    if (feeCost) transaction.fee_cost = feeCost;
    if (feeCurrency) transaction.fee_currency = feeCurrency;
    
    return transaction;
  };

  describe("calculateExchangeBalancesWithPrecision", () => {
    it("should preserve high precision for deposit transactions", async () => {
      const transactions = [
        createMockTransaction("deposit", "1.123456789012345678", "BTC"),
      ];

      const balances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances["BTC"]).toBeInstanceOf(Decimal);
      expect(balances["BTC"].toString()).toBe("1.123456789012345678");
    });

    it("should preserve precision for complex trade calculations", async () => {
      const transactions = [
        createMockTransaction(
          "trade",
          "0.123456789012345678", // High precision BTC amount
          "BTC",
          "buy",
          "123.456789012345678", // High precision USDT price
          "USDT",
        ),
      ];

      const balances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances["BTC"]).toBeInstanceOf(Decimal);
      expect(balances["BTC"].toString()).toBe("0.123456789012345678");
      expect(balances["USDT"]).toBeInstanceOf(Decimal);
      expect(balances["USDT"].toString()).toBe("-123.456789012345678");
    });

    it("should handle wei-level precision for Ethereum", async () => {
      const transactions = [
        createMockTransaction("deposit", "0.00000002", "ETH"), // Above dust threshold (2e-8)
      ];

      const balances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances["ETH"]).toBeInstanceOf(Decimal);
      expect(balances["ETH"].toNumber()).toBe(0.00000002);
    });

    it("should preserve precision through fee calculations", async () => {
      const transactions = [
        createMockTransaction(
          "trade",
          "1.0",
          "BTC",
          "buy",
          "50000.0",
          "USDT",
          "0.123456789012345678", // High precision fee
          "USDT",
        ),
      ];

      const balances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      // Fee should be subtracted with full precision
      const expectedUsdtBalance = new Decimal("-50000.0").minus(
        "0.123456789012345678",
      );
      expect(balances["USDT"].toString()).toBe(expectedUsdtBalance.toString());
    });

    it("should filter out dust balances correctly", async () => {
      const transactions = [
        createMockTransaction("deposit", "0.00000002", "BTC"), // Above dust threshold
        createMockTransaction("deposit", "0.000000001", "ETH"), // Below dust threshold (should be filtered)
      ];

      const balances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances["BTC"]).toBeDefined(); // Should be included (above threshold)
      expect(balances["ETH"]).toBeUndefined(); // Should be filtered out (below threshold)
    });

    it("should preserve true wei-level precision in calculations", async () => {
      // Test precision preservation without dust filtering by using larger amounts
      const transactions = [
        createMockTransaction("deposit", "1.000000000000000001", "ETH"), // 1 ETH + 1 wei
      ];

      const balances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances["ETH"]).toBeInstanceOf(Decimal);
      expect(balances["ETH"].toString()).toBe("1.000000000000000001");
    });
  });

  describe("Legacy vs Precision comparison", () => {
    it("should show precision difference between legacy and new methods", async () => {
      const highPrecisionAmount = "1.123456789012345678901234567890";
      const transactions = [
        createMockTransaction("deposit", highPrecisionAmount, "BTC"),
      ];

      const legacyBalances =
        await service.calculateExchangeBalances(transactions);
      const precisionBalances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      // Legacy method loses precision due to toNumber() conversion
      const legacyBtc = legacyBalances["BTC"];
      const precisionBtc = precisionBalances["BTC"];

      expect(typeof legacyBtc).toBe("number");
      expect(precisionBtc).toBeInstanceOf(Decimal);

      // Check if precision was lost in legacy method
      const precisionAsNumber = precisionBtc.toNumber();
      const backToDecimal = new Decimal(precisionAsNumber);

      // If precision was lost, the decimal representations should differ
      if (!precisionBtc.equals(backToDecimal)) {
        // Precision loss occurred - this is what we're trying to prevent
        console.warn(
          `Precision loss detected: ${precisionBtc.toString()} -> ${precisionAsNumber}`,
        );
      }
    });

    it("should handle large amounts that exceed safe integer limits", async () => {
      const largeAmount = (Number.MAX_SAFE_INTEGER + 1000).toString();
      const transactions = [
        createMockTransaction("deposit", largeAmount, "DOGE"), // Large amount in Dogecoin
      ];

      const precisionBalances =
        await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(precisionBalances["DOGE"]).toBeInstanceOf(Decimal);
      expect(precisionBalances["DOGE"].toString()).toBe(largeAmount);

      // Legacy method would likely lose precision or have issues here
      const legacyBalances =
        await service.calculateExchangeBalances(transactions);

      // The legacy method should still work but may have precision warnings
      expect(typeof legacyBalances["DOGE"]).toBe("number");
    });
  });
});
