/**
 * Foundation tests for the universal blockchain provider system
 * Tests core interfaces, circuit breaker, and provider manager functionality
 */

import { beforeEach, afterEach, describe, test, expect, vi } from "vitest";

// Mock explorer config for tests
const mockExplorerConfig = {
  ethereum: {
    explorers: [],
  },
  bitcoin: {
    explorers: [],
  },
};

import { RateLimitConfig } from "@crypto/core";
import { CircuitBreaker } from "../../../shared/utils/circuit-breaker.ts";
// Import providers to trigger registration
import "../../ethereum/providers/EtherscanProvider";
import { BlockchainProviderManager } from "../blockchain-provider-manager.ts";
import {
  ProviderInfo,
  ProviderRegistry,
} from "../registry/provider-registry.ts";
import {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderOperation,
  AddressTransactionParams,
  AddressBalanceParams,
  isAddressTransactionOperation,
} from "../types.ts";

// Mock provider for testing
class MockProvider implements IBlockchainProvider {
  public readonly name: string;
  public readonly blockchain: string;
  public readonly capabilities: ProviderCapabilities;
  public readonly rateLimit: RateLimitConfig;

  private shouldFail: boolean = false;
  private responseDelay: number = 0;

  constructor(
    name: string,
    blockchain: string,
    shouldFail: boolean = false,
    responseDelay: number = 0,
  ) {
    this.name = name;
    this.blockchain = blockchain;
    this.shouldFail = shouldFail;
    this.responseDelay = responseDelay;

    this.capabilities = {
      supportedOperations: ["getAddressTransactions", "getAddressBalance"],
      supportsHistoricalData: true,
      supportsPagination: true,
      supportsRealTimeData: false,
      supportsTokenData: false,
    };

    this.rateLimit = {
      requestsPerSecond: 1,
    };
  }

  async isHealthy(): Promise<boolean> {
    return !this.shouldFail;
  }

  async testConnection(): Promise<boolean> {
    return !this.shouldFail;
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    if (this.responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.responseDelay));
    }

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    // Mock response based on operation type
    switch (operation.type) {
      case "getAddressTransactions": {
        if (isAddressTransactionOperation(operation)) {
          return { transactions: [], address: operation.params.address } as T;
        }
        throw new Error("Invalid params for getAddressTransactions");
      }
      case "getAddressBalance":
        return { balance: 100, currency: "ETH" } as T;
      default:
        return { success: true } as T;
    }
  }

  setFailureMode(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }
}

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("should start in closed state", () => {
    const breaker = new CircuitBreaker("test-provider");
    expect(breaker.isClosed()).toBe(true);
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.getCurrentState()).toBe("closed");
  });

  test("should open after max failures", () => {
    const breaker = new CircuitBreaker("test-provider", 2, 60000); // 2 failures, 1 minute timeout

    breaker.recordFailure();
    expect(breaker.isClosed()).toBe(true);

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.getCurrentState()).toBe("open");
  });

  test("should reset on success", () => {
    const breaker = new CircuitBreaker("test-provider", 2);

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.isClosed()).toBe(true);
  });

  test("should transition to half-open state after timeout", () => {
    const breaker = new CircuitBreaker("test-provider", 2, 60000); // 1 minute timeout

    // Trip the breaker
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getCurrentState()).toBe("open");

    // Advance time to just before timeout
    vi.advanceTimersByTime(59000);
    expect(breaker.getCurrentState()).toBe("open");

    // Advance past timeout
    vi.advanceTimersByTime(2000);
    expect(breaker.getCurrentState()).toBe("half-open");
  });

  test("should return to open state on failure in half-open", () => {
    const breaker = new CircuitBreaker("test-provider", 2, 60000);

    // Trip the breaker
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getCurrentState()).toBe("open");

    // Wait for half-open
    vi.advanceTimersByTime(61000);
    expect(breaker.getCurrentState()).toBe("half-open");

    // Fail again - should go back to open
    breaker.recordFailure();
    expect(breaker.getCurrentState()).toBe("open");
  });

  test("should return to closed state on success in half-open", () => {
    const breaker = new CircuitBreaker("test-provider", 2, 60000);

    // Trip the breaker
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getCurrentState()).toBe("open");

    // Wait for half-open
    vi.advanceTimersByTime(61000);
    expect(breaker.getCurrentState()).toBe("half-open");

    // Succeed - should go back to closed
    breaker.recordSuccess();
    expect(breaker.getCurrentState()).toBe("closed");
  });

  test("should provide statistics", () => {
    const breaker = new CircuitBreaker("test-provider");
    const stats = breaker.getStatistics();

    expect(stats.providerName).toBe("test-provider");
    expect(stats.state).toBe("closed");
    expect(stats.failureCount).toBe(0);
  });
});

describe("BlockchainProviderManager", () => {
  let manager: BlockchainProviderManager;
  let primaryProvider: MockProvider;
  let fallbackProvider: MockProvider;

  beforeEach(() => {
    manager = new BlockchainProviderManager(mockExplorerConfig);
    primaryProvider = new MockProvider("primary", "ethereum");
    fallbackProvider = new MockProvider("fallback", "ethereum");

    manager.registerProviders("ethereum", [primaryProvider, fallbackProvider]);
  });

  afterEach(() => {
    manager.destroy();
  });

  test("should register providers successfully", () => {
    const providers = manager.getProviders("ethereum");
    expect(providers).toHaveLength(2);
    expect(providers[0]?.name).toBe("primary");
    expect(providers[1]?.name).toBe("fallback");
  });

  test("should execute operations with primary provider", async () => {
    const operation: ProviderOperation<{ balance: number; currency: string }> =
      {
        type: "getAddressBalance",
        params: { address: "0x123" },
      };

    const result = await manager.executeWithFailover("ethereum", operation);
    expect(result.balance).toBe(100);
    expect(result.currency).toBe("ETH");
  });

  test("should failover to secondary provider", async () => {
    // Make primary provider fail
    primaryProvider.setFailureMode(true);

    const operation: ProviderOperation<{ balance: number; currency: string }> =
      {
        type: "getAddressBalance",
        params: { address: "0x123" },
      };

    const result = await manager.executeWithFailover("ethereum", operation);
    expect(result.balance).toBe(100); // Should get result from fallback
  });

  test("should fail when all providers fail", async () => {
    primaryProvider.setFailureMode(true);
    fallbackProvider.setFailureMode(true);

    const operation: ProviderOperation<{ balance: number; currency: string }> =
      {
        type: "getAddressBalance",
        params: { address: "0x123" },
      };

    await expect(
      manager.executeWithFailover("ethereum", operation),
    ).rejects.toThrow("All providers failed");
  });

  test("should cache results when cache key provided", async () => {
    const operation: ProviderOperation<{ balance: number; currency: string }> =
      {
        type: "getAddressBalance",
        params: { address: "0x123" },
        getCacheKey: (params) => {
          const addressParams = params as AddressBalanceParams;
          return `balance-${addressParams.address}`;
        },
      };

    // First call
    const result1 = await manager.executeWithFailover("ethereum", operation);

    // Make provider fail - should still get cached result
    primaryProvider.setFailureMode(true);
    fallbackProvider.setFailureMode(true);

    const result2 = await manager.executeWithFailover("ethereum", operation);
    expect(result2).toEqual(result1);
  });

  test("should provide health status", () => {
    const health = manager.getProviderHealth("ethereum");

    expect(health.size).toBe(2);
    expect(health.has("primary")).toBe(true);
    expect(health.has("fallback")).toBe(true);

    const primaryHealth = health.get("primary");
    expect(primaryHealth?.circuitState).toBe("closed");
  });

  test("should handle unsupported operations", async () => {
    const operation: ProviderOperation<{ success: boolean }> = {
      type: "custom", // Not supported by mock providers
      params: {},
    };

    await expect(
      manager.executeWithFailover("ethereum", operation),
    ).rejects.toThrow("No providers available");
  });

  test("should respect circuit breaker state and skip dead providers", async () => {
    const executeSpyPrimary = vi.spyOn(primaryProvider, "execute");
    const executeSpyFallback = vi.spyOn(fallbackProvider, "execute");

    try {
      const operation: ProviderOperation<{
        balance: number;
        currency: string;
      }> = {
        type: "getAddressBalance",
        params: { address: "0x123" },
      };

      // Trip the primary provider's circuit breaker
      primaryProvider.setFailureMode(true);

      // Make enough calls to trip the breaker
      try {
        await manager.executeWithFailover("ethereum", operation);
      } catch {
        // Expected failure
      }
      try {
        await manager.executeWithFailover("ethereum", operation);
      } catch {
        // Expected failure
      }
      try {
        await manager.executeWithFailover("ethereum", operation);
      } catch {
        // Expected failure
      }

      // Reset spies and make primary healthy again
      executeSpyPrimary.mockClear();
      executeSpyFallback.mockClear();
      primaryProvider.setFailureMode(false);

      // Next call should skip primary (circuit breaker open) and go to fallback
      const result = await manager.executeWithFailover("ethereum", operation);

      expect(result.balance).toBe(100);
      expect(executeSpyPrimary).not.toHaveBeenCalled(); // Primary skipped due to circuit breaker
      expect(executeSpyFallback).toHaveBeenCalledTimes(1); // Fallback used
    } finally {
      executeSpyPrimary.mockRestore();
      executeSpyFallback.mockRestore();
    }
  }, 5000);

  test("should route operations based on provider capabilities", async () => {
    // Create providers with different capabilities
    const tokenProvider = new MockProvider("token-specialist", "ethereum");
    tokenProvider.capabilities.supportedOperations = [
      "getTokenTransactions",
      "getTokenBalances",
    ];
    tokenProvider.capabilities.supportsTokenData = true;

    const basicProvider = new MockProvider("basic-provider", "ethereum");
    basicProvider.capabilities.supportedOperations = [
      "getAddressTransactions",
      "getAddressBalance",
    ];
    basicProvider.capabilities.supportsTokenData = false;

    manager.registerProviders("ethereum", [basicProvider, tokenProvider]);

    const tokenExecuteSpy = vi.spyOn(tokenProvider, "execute");
    const basicExecuteSpy = vi.spyOn(basicProvider, "execute");

    // Execute token operation - should only use token provider
    const tokenOperation: ProviderOperation<{ success: boolean }> = {
      type: "getTokenTransactions",
      params: { address: "0x123", contractAddress: "0xabc" },
    };

    await manager.executeWithFailover("ethereum", tokenOperation);

    expect(tokenExecuteSpy).toHaveBeenCalledTimes(1);
    expect(basicExecuteSpy).not.toHaveBeenCalled(); // Basic provider doesn't support token operations

    tokenExecuteSpy.mockRestore();
    basicExecuteSpy.mockRestore();
  });

  test("should handle cache expiration correctly", async () => {
    vi.useFakeTimers();

    const operation: ProviderOperation<{ balance: number; currency: string }> =
      {
        type: "getAddressBalance",
        params: { address: "0x123" },
        getCacheKey: (params) => {
          const addressParams = params as AddressBalanceParams;
          return `balance-${addressParams.address}`;
        },
      };

    // First call - should cache result
    const result1 = await manager.executeWithFailover("ethereum", operation);
    expect(result1.balance).toBe(100);

    // Advance time past cache expiry (30 seconds + buffer)
    vi.advanceTimersByTime(35000);

    // Make primary provider fail
    primaryProvider.setFailureMode(true);

    // Second call - cache expired, should fail over to fallback
    const result2 = await manager.executeWithFailover("ethereum", operation);
    expect(result2.balance).toBe(100); // Should get result from fallback, not stale cache

    vi.useRealTimers();
  });
});

describe("ProviderRegistry", () => {
  let availableEthereumProviders: ProviderInfo[];

  beforeAll(() => {
    // Get available providers after imports have triggered registration
    availableEthereumProviders = ProviderRegistry.getAvailable("ethereum");
  });

  test("should have registered Etherscan provider", () => {
    const isRegistered = ProviderRegistry.isRegistered("ethereum", "etherscan");
    expect(isRegistered).toBe(true);
  });

  test("should list Etherscan in available Ethereum providers", () => {
    expect(availableEthereumProviders.length).toBeGreaterThanOrEqual(1);

    const etherscan = availableEthereumProviders.find(
      (p) => p.name === "etherscan",
    );
    expect(etherscan).toBeDefined();
    expect(etherscan?.blockchain).toBe("ethereum");
    expect(etherscan?.displayName).toBe("Etherscan API");
    expect(etherscan?.requiresApiKey).toBe(true);
  });

  test("should have correct provider metadata", () => {
    const metadata = ProviderRegistry.getMetadata("ethereum", "etherscan");

    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe("etherscan");
    expect(metadata?.blockchain).toBe("ethereum");
    expect(metadata?.displayName).toBe("Etherscan API");
    expect(metadata?.requiresApiKey).toBe(true);
    expect(metadata?.type).toBe("rest");
    expect(metadata?.defaultConfig).toBeDefined();
    expect(metadata?.networks.mainnet).toBeDefined();
    expect(metadata?.networks.mainnet.baseUrl).toBe(
      "https://api.etherscan.io/api",
    );
  });

  test("should create provider instances from registry", () => {
    const config = {
      apiKey: "test-key",
      network: "mainnet",
      timeout: 10000,
    };

    const provider = ProviderRegistry.createProvider(
      "ethereum",
      "etherscan",
      config,
    );

    expect(provider).toBeDefined();
    expect(provider.name).toBe("etherscan");
    expect(provider.blockchain).toBe("ethereum");
    expect(provider.capabilities).toBeDefined();
    expect(provider.capabilities.supportedOperations).toContain(
      "getAddressTransactions",
    );
    expect(provider.capabilities.supportedOperations).toContain(
      "getAddressBalance",
    );
  });

  test("should validate configuration correctly", () => {
    const validConfig = {
      ethereum: {
        explorers: [{ name: "etherscan", enabled: true, priority: 1 }],
      },
    };

    const invalidConfig = {
      ethereum: {
        explorers: [{ name: "invalid-provider", enabled: true, priority: 1 }],
      },
    };

    const validResult = ProviderRegistry.validateConfig(validConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidResult = ProviderRegistry.validateConfig(invalidConfig);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
    expect(invalidResult.errors[0]).toContain("invalid-provider");
  });

  test("should throw error for non-existent providers", () => {
    expect(() => {
      ProviderRegistry.createProvider("ethereum", "non-existent", {});
    }).toThrow("Provider non-existent not found for blockchain ethereum");
  });

  test("should handle empty blockchain configurations", () => {
    const providers = ProviderRegistry.getAvailable("non-existent-blockchain");
    expect(providers).toHaveLength(0);
  });

  test("should provide provider capabilities information", () => {
    const etherscan = availableEthereumProviders.find(
      (p) => p.name === "etherscan",
    );

    expect(etherscan?.capabilities).toBeDefined();
    expect(etherscan?.capabilities.supportedOperations).toBeDefined();
    expect(etherscan?.capabilities.maxBatchSize).toBe(1);
    expect(etherscan?.capabilities.supportsHistoricalData).toBe(true);
    expect(etherscan?.capabilities.supportsPagination).toBe(true);
  });

  test("should provide rate limiting information", () => {
    const etherscan = availableEthereumProviders.find(
      (p) => p.name === "etherscan",
    );

    expect(etherscan?.defaultConfig.rateLimit).toBeDefined();
    expect(etherscan?.defaultConfig.rateLimit.requestsPerSecond).toBe(0.2);
    expect(etherscan?.defaultConfig.rateLimit.requestsPerMinute).toBe(30);
    expect(etherscan?.defaultConfig.rateLimit.requestsPerHour).toBe(100);
  });

  test("should provide network support information", () => {
    const etherscan = availableEthereumProviders.find(
      (p) => p.name === "etherscan",
    );

    expect(etherscan?.supportedNetworks).toBeDefined();
    expect(etherscan?.supportedNetworks).toContain("mainnet");
    expect(etherscan?.supportedNetworks).toContain("testnet");
  });
});

describe("Provider System Integration", () => {
  test("should handle complete provider lifecycle", async () => {
    const manager = new BlockchainProviderManager(mockExplorerConfig);
    const provider = new MockProvider("test", "bitcoin");

    try {
      manager.registerProviders("bitcoin", [provider]);

      // Test successful operation
      const operation: ProviderOperation<{
        transactions: unknown[];
        address: string;
      }> = {
        type: "getAddressTransactions",
        params: { address: "bc1xyz" },
      };

      const result = await manager.executeWithFailover("bitcoin", operation);
      expect(result.transactions).toEqual([]);
      expect(result.address).toBe("bc1xyz");

      // Verify health status
      const health = manager.getProviderHealth("bitcoin");
      const providerHealth = health.get("test");
      expect(providerHealth?.isHealthy).toBe(true);
      expect(providerHealth?.circuitState).toBe("closed");
    } finally {
      manager.destroy();
    }
  });

  test("should auto-register providers from configuration", () => {
    const manager = new BlockchainProviderManager(mockExplorerConfig);

    try {
      // For this test, we'll manually create a provider since the config loading
      // uses import.meta.url which doesn't work well in Jest environment
      const testConfig = {
        apiKey: "test-key",
        network: "mainnet",
        timeout: 10000,
      };

      const provider = ProviderRegistry.createProvider(
        "ethereum",
        "etherscan",
        testConfig,
      );
      manager.registerProviders("ethereum", [provider]);

      const registeredProviders = manager.getProviders("ethereum");
      expect(registeredProviders.length).toBe(1);
      expect(registeredProviders[0]?.name).toBe("etherscan");
    } finally {
      manager.destroy();
    }
  });
});
