/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import { loadExplorerConfig, ProviderRegistry } from '@exitbook/blockchain-providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BenchmarkRateLimitHandler } from '../benchmark-rate-limit-handler.js';

// Mock dependencies
vi.mock('@exitbook/blockchain-providers', async () => {
  const actual = await vi.importActual('@exitbook/blockchain-providers');
  return {
    ...actual,
    loadExplorerConfig: vi.fn(),
    ProviderRegistry: {
      getAllProviders: vi.fn(),
    },
  };
});

describe('BenchmarkRateLimitHandler', () => {
  let handler: BenchmarkRateLimitHandler;
  let mockLoadExplorerConfig: ReturnType<typeof vi.fn>;
  let MockProviderManagerConstructor: ReturnType<typeof vi.fn>;
  let mockProviderManager: {
    autoRegisterFromConfig: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock loadExplorerConfig
    mockLoadExplorerConfig = vi.mocked(loadExplorerConfig);
    mockLoadExplorerConfig.mockReturnValue({} as ReturnType<typeof loadExplorerConfig>);

    // Mock provider manager instance
    mockProviderManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn(),
    };

    // Mock provider manager constructor
    MockProviderManagerConstructor = vi.fn().mockImplementation(function () {
      return mockProviderManager;
    });

    // Create handler
    handler = new BenchmarkRateLimitHandler();
  });

  afterEach(async () => {
    await handler.destroy();
  });

  describe('execute', () => {
    it('should successfully benchmark a provider', async () => {
      // Setup mock provider with benchmark capability
      const mockProvider = {
        name: 'blockstream.info',
        rateLimit: { requestsPerSecond: 5, burstLimit: 10 },
        benchmarkRateLimit: vi.fn().mockResolvedValue({
          testResults: [
            { rate: 1, success: true, responseTimeMs: 200 },
            { rate: 2, success: true, responseTimeMs: 210 },
            { rate: 5, success: false, responseTimeMs: 500 },
          ],
          burstLimits: [
            { limit: 5, success: true },
            { limit: 10, success: false },
          ],
          maxSafeRate: 2,
          recommended: {
            requestsPerSecond: 1.6,
            burstLimit: 4,
          },
        }),
      };

      mockProviderManager.autoRegisterFromConfig.mockReturnValue([mockProvider]);

      // Execute
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
          maxRate: '5',
          numRequests: '10',
        },
        MockProviderManagerConstructor as never
      );

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.params.blockchain).toBe('bitcoin');
        expect(result.value.params.provider).toBe('blockstream.info');
        expect(result.value.params.maxRate).toBe(5);
        expect(result.value.params.numRequests).toBe(10);
        expect(result.value.provider.name).toBe('blockstream.info');
        expect(result.value.result.maxSafeRate).toBe(2);
        expect(result.value.result.recommended.requestsPerSecond).toBe(1.6);
      }

      // Verify benchmark was called with correct params
      expect(mockProvider.benchmarkRateLimit).toHaveBeenCalledWith(5, 10, true, undefined);
    });

    it('should pass custom rates to benchmark', async () => {
      const mockProvider = {
        name: 'blockstream.info',
        rateLimit: { requestsPerSecond: 5 },
        benchmarkRateLimit: vi.fn().mockResolvedValue({
          testResults: [{ rate: 1, success: true }],
          maxSafeRate: 1,
          recommended: { requestsPerSecond: 0.8 },
        }),
      };

      mockProviderManager.autoRegisterFromConfig.mockReturnValue([mockProvider]);

      // Execute with custom rates
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
          rates: '0.5,1,2',
        },
        MockProviderManagerConstructor as never
      );

      // Verify custom rates were passed
      expect(result.isOk()).toBe(true);
      expect(mockProvider.benchmarkRateLimit).toHaveBeenCalledWith(5, 10, true, [0.5, 1, 2]);
    });

    it('should skip burst tests when skipBurst is true', async () => {
      const mockProvider = {
        name: 'blockstream.info',
        rateLimit: { requestsPerSecond: 5 },
        benchmarkRateLimit: vi.fn().mockResolvedValue({
          testResults: [{ rate: 1, success: true }],
          maxSafeRate: 1,
          recommended: { requestsPerSecond: 0.8 },
        }),
      };

      mockProviderManager.autoRegisterFromConfig.mockReturnValue([mockProvider]);

      // Execute with skipBurst
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
          skipBurst: true,
        },
        MockProviderManagerConstructor as never
      );

      // Verify burst testing was disabled (3rd param should be false)
      expect(result.isOk()).toBe(true);
      expect(mockProvider.benchmarkRateLimit).toHaveBeenCalledWith(5, 10, false, undefined);
    });

    it('should return error when provider is not found for blockchain', async () => {
      // Mock empty provider list
      mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);

      // Mock available providers for helpful error message
      vi.mocked(ProviderRegistry.getAllProviders).mockReturnValue([
        {
          blockchain: 'bitcoin',
          name: 'blockstream.info',
          displayName: '',
          requiresApiKey: false,
          defaultConfig: {
            rateLimit: {
              requestsPerSecond: 0,
            },
            retries: 0,
            timeout: 0,
          },
          capabilities: {
            supportedOperations: [],
          },
        },
        {
          blockchain: 'bitcoin',
          name: 'mempool.space',
          displayName: '',
          requiresApiKey: false,
          capabilities: {
            supportedOperations: [],
          },
          defaultConfig: {
            rateLimit: {
              requestsPerSecond: 0,
            },
            retries: 0,
            timeout: 0,
          },
        },
        {
          blockchain: 'ethereum',
          name: 'etherscan',
          displayName: '',
          requiresApiKey: false,
          capabilities: {
            supportedOperations: [],
          },
          defaultConfig: {
            rateLimit: {
              requestsPerSecond: 0,
            },
            retries: 0,
            timeout: 0,
          },
        },
      ]);

      // Execute
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'invalid-provider',
        },
        MockProviderManagerConstructor as never
      );

      // Verify error with helpful message
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("Provider 'invalid-provider' not found");
        expect(result.error.message).toContain('bitcoin');
        expect(result.error.message).toContain('blockstream.info');
        expect(result.error.message).toContain('mempool.space');
      }
    });

    it('should return error when blockchain is not supported', async () => {
      // Mock empty provider list
      mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);

      // Mock available blockchains for helpful error message
      vi.mocked(ProviderRegistry.getAllProviders).mockReturnValue([
        {
          blockchain: 'bitcoin',
          name: 'blockstream.info',
          displayName: '',
          requiresApiKey: false,
          capabilities: {
            supportedOperations: [],
          },
          defaultConfig: {
            rateLimit: { requestsPerSecond: 0 },
            retries: 0,
            timeout: 0,
          },
        },
        {
          blockchain: 'ethereum',
          name: 'etherscan',
          displayName: '',
          requiresApiKey: false,
          capabilities: {
            supportedOperations: [],
          },
          defaultConfig: {
            rateLimit: { requestsPerSecond: 0 },
            retries: 0,
            timeout: 0,
          },
        },
        {
          blockchain: 'solana',
          name: 'helius',
          displayName: '',
          requiresApiKey: false,
          capabilities: {
            supportedOperations: [],
          },
          defaultConfig: {
            rateLimit: { requestsPerSecond: 0 },
            retries: 0,
            timeout: 0,
          },
        },
      ]);

      // Execute
      const result = await handler.execute(
        {
          blockchain: 'invalid-blockchain',
          provider: 'some-provider',
        },
        MockProviderManagerConstructor as never
      );

      // Verify error with helpful message
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("No providers registered for blockchain 'invalid-blockchain'");
        expect(result.error.message).toContain('bitcoin');
        expect(result.error.message).toContain('ethereum');
        expect(result.error.message).toContain('solana');
      }
    });

    it('should return error for invalid blockchain parameter', async () => {
      const result = await handler.execute(
        {
          blockchain: '',
          provider: 'blockstream.info',
        },
        MockProviderManagerConstructor as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Blockchain is required');
      }
    });

    it('should return error for invalid provider parameter', async () => {
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: '',
        },
        MockProviderManagerConstructor as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Provider is required');
      }
    });

    it('should return error for invalid maxRate', async () => {
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
          maxRate: 'invalid',
        },
        MockProviderManagerConstructor as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid max-rate value');
      }
    });

    it('should return error for invalid numRequests', async () => {
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
          numRequests: 'invalid',
        },
        MockProviderManagerConstructor as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid num-requests value');
      }
    });

    it('should return error for invalid custom rates', async () => {
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
          rates: '1,invalid,5',
        },
        MockProviderManagerConstructor as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid rates');
      }
    });

    it('should handle benchmark errors gracefully', async () => {
      const mockProvider = {
        name: 'blockstream.info',
        rateLimit: { requestsPerSecond: 5 },
        benchmarkRateLimit: vi.fn().mockRejectedValue(new Error('Network timeout during benchmark')),
      };

      mockProviderManager.autoRegisterFromConfig.mockReturnValue([mockProvider]);

      // Execute
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
        },
        MockProviderManagerConstructor as never
      );

      // Verify error is propagated
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network timeout during benchmark');
      }
    });

    it('should use default values for optional parameters', async () => {
      const mockProvider = {
        name: 'blockstream.info',
        rateLimit: { requestsPerSecond: 5 },
        benchmarkRateLimit: vi.fn().mockResolvedValue({
          testResults: [{ rate: 1, success: true }],
          maxSafeRate: 1,
          recommended: { requestsPerSecond: 0.8 },
        }),
      };

      mockProviderManager.autoRegisterFromConfig.mockReturnValue([mockProvider]);

      // Execute with minimal options
      const result = await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
        },
        MockProviderManagerConstructor as never
      );

      // Verify defaults were used
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.params.maxRate).toBe(5); // default
        expect(result.value.params.numRequests).toBe(10); // default
        expect(result.value.params.skipBurst).toBe(false); // default
      }
    });
  });

  describe('destroy', () => {
    it('should cleanup provider manager', async () => {
      const mockProvider = {
        name: 'blockstream.info',
        rateLimit: { requestsPerSecond: 5 },
        benchmarkRateLimit: vi.fn().mockResolvedValue({
          testResults: [],
          maxSafeRate: 1,
          recommended: { requestsPerSecond: 0.8 },
        }),
      };

      mockProviderManager.autoRegisterFromConfig.mockReturnValue([mockProvider]);

      // Execute to initialize provider manager
      await handler.execute(
        {
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
        },
        MockProviderManagerConstructor as never
      );

      // Destroy
      await handler.destroy();

      // Verify provider manager was destroyed
      expect(mockProviderManager.destroy).toHaveBeenCalled();
    });

    it('should be safe to call without execute', () => {
      expect(() => handler.destroy()).not.toThrow();
    });

    it('should be safe to call multiple times', async () => {
      await handler.destroy();
      await expect(handler.destroy()).resolves.not.toThrow();
    });
  });
});
