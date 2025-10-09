import { ProcessorFactory } from '@exitbook/import';
import type { ProviderInfo } from '@exitbook/providers';
import { ProviderRegistry } from '@exitbook/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListBlockchainsHandler } from './list-blockchains-handler.ts';

// Mock dependencies
vi.mock('@exitbook/import');
vi.mock('@exitbook/providers');

describe('ListBlockchainsHandler', () => {
  let handler: ListBlockchainsHandler;
  let mockGetSupportedSources: ReturnType<typeof vi.fn>;
  let mockGetAllProviders: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock ProcessorFactory
    mockGetSupportedSources = vi.fn();
    vi.mocked(ProcessorFactory).mockImplementation(
      () =>
        ({
          getSupportedSources: mockGetSupportedSources,
        }) as Partial<ProcessorFactory> as ProcessorFactory
    );

    // Mock ProviderRegistry
    mockGetAllProviders = vi.fn();
    const getAllProviders = mockGetAllProviders;
    vi.mocked(ProviderRegistry).getAllProviders = getAllProviders;

    // Create handler
    handler = new ListBlockchainsHandler();
  });

  afterEach(() => {
    handler.destroy();
  });

  describe('execute', () => {
    it('should return list of blockchains with providers', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin', 'ethereum']);
      mockGetAllProviders.mockReturnValue([
        createMockProvider('blockstream', 'bitcoin', false),
        createMockProvider('alchemy', 'ethereum', true),
      ]);

      // Execute
      const result = await handler.execute({});

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.blockchains).toHaveLength(2);
        expect(result.value.blockchains[0]!.name).toBe('bitcoin');
        expect(result.value.blockchains[1]!.name).toBe('ethereum');
        expect(result.value.summary.totalBlockchains).toBe(2);
        expect(result.value.summary.totalProviders).toBe(2);
      }
    });

    it('should filter blockchains by valid category', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin', 'ethereum', 'polygon']);
      mockGetAllProviders.mockReturnValue([
        createMockProvider('blockstream', 'bitcoin', false),
        createMockProvider('alchemy', 'ethereum', true),
        createMockProvider('alchemy', 'polygon', true),
      ]);

      // Execute with evm filter
      const result = await handler.execute({ category: 'evm' });

      // Verify - should only include EVM chains (ethereum and polygon)
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.blockchains).toHaveLength(2);
        expect(result.value.blockchains[0]!.name).toBe('ethereum');
        expect(result.value.blockchains[1]!.name).toBe('polygon');
      }
    });

    it('should return error for invalid category', async () => {
      // Setup mocks (though they won't be called)
      mockGetSupportedSources.mockResolvedValue([]);
      mockGetAllProviders.mockReturnValue([]);

      // Execute with invalid category
      const result = await handler.execute({ category: 'invalid-category' });

      // Verify
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid category');
      }
    });

    it('should filter blockchains that require API key', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin', 'ethereum']);
      mockGetAllProviders.mockReturnValue([
        createMockProvider('blockstream', 'bitcoin', false), // No API key
        createMockProvider('alchemy', 'ethereum', true), // Requires API key
      ]);

      // Execute with requiresApiKey=true filter
      const result = await handler.execute({ requiresApiKey: true });

      // Verify - should only include blockchains where ALL providers require API key
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.blockchains).toHaveLength(1);
        expect(result.value.blockchains[0]!.name).toBe('ethereum');
      }
    });

    it('should filter blockchains that do not require API key', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin', 'ethereum']);
      mockGetAllProviders.mockReturnValue([
        createMockProvider('blockstream', 'bitcoin', false), // No API key
        createMockProvider('alchemy', 'ethereum', true), // Requires API key
      ]);

      // Execute with requiresApiKey=false filter
      const result = await handler.execute({ requiresApiKey: false });

      // Verify - should include blockchains with at least one no-API-key provider
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.blockchains).toHaveLength(1);
        expect(result.value.blockchains[0]!.name).toBe('bitcoin');
      }
    });

    it('should include detailed provider information when detailed=true', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin']);
      mockGetAllProviders.mockReturnValue([
        {
          name: 'blockstream',
          displayName: 'Blockstream',
          blockchain: 'bitcoin',
          requiresApiKey: false,
          capabilities: {
            supportedOperations: ['getAddressTransactions'],
          },
          defaultConfig: {
            rateLimit: {
              requestsPerSecond: 2,
              requestsPerMinute: 120,
            },
            retries: 3,
            timeout: 30000,
          },
        },
      ]);

      // Execute with detailed=true
      const result = await handler.execute({ detailed: true });

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const provider = result.value.blockchains[0]!.providers[0]!;
        expect(provider.rateLimit).toBe('2/sec');
      }
    });

    it('should not include detailed provider information when detailed=false', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin']);
      mockGetAllProviders.mockReturnValue([
        {
          name: 'blockstream',
          displayName: 'Blockstream',
          blockchain: 'bitcoin',
          requiresApiKey: false,
          capabilities: {
            supportedOperations: ['getAddressTransactions'],
          },
          defaultConfig: {
            rateLimit: {
              requestsPerSecond: 2,
              requestsPerMinute: 120,
            },
            retries: 3,
            timeout: 30000,
          },
        },
      ]);

      // Execute with detailed=false
      const result = await handler.execute({ detailed: false });

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const provider = result.value.blockchains[0]!.providers[0]!;
        expect(provider.rateLimit).toBeUndefined();
      }
    });

    it('should handle blockchains with no providers', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin', 'ethereum']);
      mockGetAllProviders.mockReturnValue([
        createMockProvider('blockstream', 'bitcoin', false),
        // No Ethereum providers
      ]);

      // Execute
      const result = await handler.execute({});

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.blockchains).toHaveLength(2);
        const ethereumInfo = result.value.blockchains.find((b) => b.name === 'ethereum');
        expect(ethereumInfo?.providers).toHaveLength(0);
        expect(ethereumInfo?.providerCount).toBe(0);
      }
    });

    it('should handle blockchains with multiple providers', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin']);
      mockGetAllProviders.mockReturnValue([
        createMockProvider('blockstream', 'bitcoin', false),
        createMockProvider('mempool', 'bitcoin', false),
        createMockProvider('tatum', 'bitcoin', true),
      ]);

      // Execute
      const result = await handler.execute({});

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const bitcoinInfo = result.value.blockchains[0]!;
        expect(bitcoinInfo.providers).toHaveLength(3);
        expect(bitcoinInfo.providerCount).toBe(3);
        expect(bitcoinInfo.requiresApiKey).toBe(true); // At least one requires API key
        expect(bitcoinInfo.hasNoApiKeyProvider).toBe(true); // At least one doesn't
      }
    });

    it('should sort blockchains by popularity', async () => {
      // Setup mocks with blockchains in random order
      mockGetSupportedSources.mockResolvedValue(['solana', 'kusama', 'bitcoin', 'polygon', 'ethereum']);
      mockGetAllProviders.mockReturnValue([
        createMockProvider('provider1', 'bitcoin', false),
        createMockProvider('provider2', 'ethereum', false),
        createMockProvider('provider3', 'polygon', false),
        createMockProvider('provider4', 'solana', false),
        createMockProvider('provider5', 'kusama', false),
      ]);

      // Execute
      const result = await handler.execute({});

      // Verify - should be sorted by popularity
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const names = result.value.blockchains.map((b) => b.name);
        expect(names).toEqual(['bitcoin', 'ethereum', 'solana', 'polygon', 'kusama']);
      }
    });

    it('should build correct summary statistics', async () => {
      // Setup mocks
      mockGetSupportedSources.mockResolvedValue(['bitcoin', 'ethereum', 'polygon']);
      const allProviders = [
        createMockProvider('blockstream', 'bitcoin', false),
        createMockProvider('alchemy', 'ethereum', true),
        createMockProvider('alchemy-polygon', 'polygon', true),
      ];
      mockGetAllProviders.mockReturnValue(allProviders);

      // Execute
      const result = await handler.execute({});

      // Verify summary
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value.summary;
        expect(summary.totalBlockchains).toBe(3);
        expect(summary.totalProviders).toBe(3);
        expect(summary.requireApiKey).toBe(2);
        expect(summary.noApiKey).toBe(1);
        expect(summary.byCategory.utxo).toBe(1);
        expect(summary.byCategory.evm).toBe(2);
      }
    });
  });

  describe('destroy', () => {
    it('should cleanup resources without error', () => {
      expect(() => handler.destroy()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      handler.destroy();
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});

// Helper function to create mock provider
function createMockProvider(name: string, blockchain: string, requiresApiKey: boolean): ProviderInfo {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    blockchain,
    requiresApiKey,
    capabilities: {
      supportedOperations: ['getAddressTransactions'],
    },
    defaultConfig: {
      rateLimit: {
        requestsPerSecond: 1,
        requestsPerMinute: 60,
      },
      retries: 3,
      timeout: 30000,
    },
  };
}
