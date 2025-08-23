import { beforeEach, describe, expect, it } from "vitest";
import { MempoolSpaceProvider } from "../MempoolSpaceProvider.ts";
import type { BlockchainTransaction } from "@crypto/core";
import type { MempoolTransaction, AddressInfo } from "../../types.ts";

describe("MempoolSpaceProvider Integration", () => {
  let provider: MempoolSpaceProvider;

  beforeEach(() => {
    provider = new MempoolSpaceProvider();
  });

  describe("Provider Configuration", () => {
    it("should initialize with correct registry metadata", () => {
      expect(provider.name).toBe("mempool.space");
      expect(provider.blockchain).toBe("bitcoin");
      expect(provider.capabilities.supportedOperations).toContain(
        "getAddressTransactions",
      );
      expect(provider.capabilities.supportedOperations).toContain(
        "getAddressBalance",
      );
      expect(provider.capabilities.supportedOperations).toContain(
        "parseWalletTransaction",
      );
    });

    it("should have correct rate limiting configuration", () => {
      expect(provider.rateLimit.requestsPerSecond).toBe(0.25);
      expect(provider.rateLimit.burstLimit).toBe(1);
    });

    it("should have correct capabilities", () => {
      const capabilities = provider.capabilities;
      expect(capabilities.maxBatchSize).toBe(25);
      expect(capabilities.supportsHistoricalData).toBe(true);
      expect(capabilities.supportsPagination).toBe(true);
      expect(capabilities.supportsRealTimeData).toBe(true);
      expect(capabilities.supportsTokenData).toBe(false);
    });
  });

  describe("Health Checks", () => {
    it("should report healthy when API is accessible", async () => {
      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(true);
    }, 30000);

    it("should pass connection test", async () => {
      const connectionTest = await provider.testConnection();
      expect(connectionTest).toBe(true);
    }, 30000);
  });


  describe("Address Transactions", () => {
    const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"; // Known address with transactions

    it("should fetch address transactions successfully", async () => {
      const transactions = await provider.execute<BlockchainTransaction[]>({
        type: "getAddressTransactions",
        params: { address: testAddress },
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty("hash");
        expect(transactions[0]).toHaveProperty("timestamp");
        expect(transactions[0]).toHaveProperty("value");
        expect(transactions[0].value).toHaveProperty("amount");
        expect(transactions[0].value).toHaveProperty("currency", "BTC");
        expect(["transfer_in", "transfer_out"]).toContain(transactions[0].type);
        expect(["success", "pending"]).toContain(transactions[0].status);
      }
    }, 30000);

    it("should return empty array for unused address", async () => {
      const unusedAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"; // Genesis block address, unlikely to have new txs
      
      const transactions = await provider.execute<BlockchainTransaction[]>({
        type: "getAddressTransactions",
        params: { address: unusedAddress },
      });

      expect(Array.isArray(transactions)).toBe(true);
    }, 30000);

    it("should filter transactions by timestamp when since parameter is provided", async () => {
      const futureTimestamp = Date.now() + 86400000; // 24 hours from now

      const transactions = await provider.execute<BlockchainTransaction[]>({
        type: "getAddressTransactions",
        params: { address: testAddress, since: futureTimestamp },
      });

      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions).toHaveLength(0);
    }, 30000);
  });

  describe("Address Balance", () => {
    const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";

    it("should fetch address balance successfully", async () => {
      const result = await provider.execute<{ balance: string; token: string }>({
        type: "getAddressBalance",
        params: { address: testAddress },
      });

      expect(result).toHaveProperty("balance");
      expect(result).toHaveProperty("token", "BTC");
      expect(typeof result.balance).toBe("string");
      expect(Number.isNaN(Number(result.balance))).toBe(false);
    }, 30000);

    it("should handle empty address balance", async () => {
      const emptyAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"; // Empty bech32 address
      
      const result = await provider.execute<{ balance: string; token: string }>({
        type: "getAddressBalance",
        params: { address: emptyAddress },
      });

      expect(result).toEqual({
        balance: "0",
        token: "BTC",
      });
    }, 30000);
  });

  describe("Error Handling", () => {
    it("should throw error for unsupported operations", async () => {
      await expect(
        provider.execute({
          type: "unsupportedOperation" as "getAddressTransactions",
          params: {},
        }),
      ).rejects.toThrow("Unsupported operation: unsupportedOperation");
    });

    it("should handle invalid address format gracefully", async () => {
      const invalidAddress = "invalid-address-format";
      
      await expect(
        provider.execute({
          type: "getAddressBalance",
          params: { address: invalidAddress },
        }),
      ).rejects.toThrow();
    }, 30000);
  });

  describe("Address Info", () => {
    const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";

    it("should fetch address info successfully", async () => {
      const result = await provider.execute<AddressInfo>({
        type: "getAddressInfo",
        params: { address: testAddress },
      });

      expect(result).toHaveProperty("txCount");
      expect(result).toHaveProperty("balance");
      expect(typeof result.txCount).toBe("number");
      expect(typeof result.balance).toBe("string");
    }, 30000);
  });

  describe("Raw Address Transactions", () => {
    const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";

    it("should fetch raw address transactions successfully", async () => {
      const transactions = await provider.execute<MempoolTransaction[]>({
        type: "getRawAddressTransactions",
        params: { address: testAddress },
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty("txid");
        expect(transactions[0]).toHaveProperty("vin");
        expect(transactions[0]).toHaveProperty("vout");
        expect(transactions[0]).toHaveProperty("status");
      }
    }, 30000);
  });

  describe("Parse Wallet Transaction", () => {
    it("should parse wallet transaction with multiple addresses", async () => {
      // First get a real transaction to test with
      const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
      const rawTransactions = await provider.execute<MempoolTransaction[]>({
        type: "getRawAddressTransactions", 
        params: { address: testAddress },
      });

      if (rawTransactions.length > 0) {
        const walletAddresses = [testAddress];
        const parsedTx = await provider.execute<BlockchainTransaction>({
          type: "parseWalletTransaction",
          params: {
            tx: rawTransactions[0],
            walletAddresses,
          },
        });

        expect(parsedTx).toHaveProperty("hash");
        expect(parsedTx).toHaveProperty("timestamp");
        expect(parsedTx).toHaveProperty("value");
        expect(parsedTx.value).toHaveProperty("currency", "BTC");
        expect(["transfer_in", "transfer_out", "internal_transfer_in", "internal_transfer_out"]).toContain(parsedTx.type);
      }
    }, 30000);
  });
});
