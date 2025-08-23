import { describe, it, expect } from "vitest";
import { UniversalAdapterFactory } from "../adapter-factory.ts";
import type { UniversalExchangeAdapterConfig } from "@crypto/core";

describe("UniversalAdapterFactory", () => {
  describe("Native Exchange Adapters", () => {
    it("should create native Coinbase adapter", async () => {
      const config: UniversalExchangeAdapterConfig = {
        type: "exchange",
        id: "coinbase",
        subType: "native",
        credentials: {
          apiKey: "test-key",
          secret: "test-secret",
          password: "test-passphrase",
        },
      };

      const adapter = await UniversalAdapterFactory.create(config);
      
      expect(adapter).toBeDefined();
      
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

      await adapter.close();
    });

    it("should throw error for unsupported native exchange", async () => {
      const config: UniversalExchangeAdapterConfig = {
        type: "exchange",
        id: "unsupported",
        subType: "native",
        credentials: {
          apiKey: "test-key",
          secret: "test-secret",
        },
      };

      await expect(UniversalAdapterFactory.create(config)).rejects.toThrow(
        "Unsupported native exchange: unsupported"
      );
    });

    it("should throw error for native adapter without credentials", async () => {
      const config: UniversalExchangeAdapterConfig = {
        type: "exchange",
        id: "coinbase",
        subType: "native",
      };

      await expect(UniversalAdapterFactory.create(config)).rejects.toThrow(
        "Credentials required for native exchange adapters"
      );
    });
  });

  describe("createExchangeConfig helper", () => {
    it("should create native exchange config", () => {
      const config = UniversalAdapterFactory.createExchangeConfig(
        "coinbase",
        "native",
        {
          credentials: {
            apiKey: "test-key",
            secret: "test-secret",
            password: "test-passphrase",
          },
        }
      );

      expect(config).toEqual({
        type: "exchange",
        id: "coinbase",
        subType: "native",
        credentials: {
          apiKey: "test-key",
          secret: "test-secret",
          password: "test-passphrase",
        },
        csvDirectories: undefined,
      });
    });
  });
});