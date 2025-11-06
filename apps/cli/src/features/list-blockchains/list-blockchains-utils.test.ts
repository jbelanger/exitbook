import type { ProviderInfo, ProviderOperationType } from '@exitbook/providers';
import { describe, expect, it } from 'vitest';

import type { BlockchainInfo } from './list-blockchains-utils.js';
import {
  buildBlockchainInfo,
  buildSummary,
  filterByApiKeyRequirement,
  filterByCategory,
  getBlockchainCategory,
  getBlockchainLayer,
  providerToSummary,
  sortBlockchains,
  validateCategory,
} from './list-blockchains-utils.js';

describe('list-blockchains-utils', () => {
  describe('validateCategory', () => {
    it('should validate valid categories', () => {
      const result = validateCategory('evm');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('evm');
      }
    });

    it('should validate all valid category options', () => {
      const categories = ['evm', 'substrate', 'cosmos', 'utxo', 'solana', 'all'];
      for (const category of categories) {
        const result = validateCategory(category);
        expect(result.isOk()).toBe(true);
      }
    });

    it('should reject invalid categories', () => {
      const result = validateCategory('invalid');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid category');
      }
    });
  });

  describe('getBlockchainCategory', () => {
    it('should return evm for EVM blockchains', () => {
      expect(getBlockchainCategory('ethereum')).toBe('evm');
      expect(getBlockchainCategory('polygon')).toBe('evm');
      expect(getBlockchainCategory('arbitrum-one')).toBe('evm');
    });

    it('should return substrate for Substrate blockchains', () => {
      expect(getBlockchainCategory('polkadot')).toBe('substrate');
      expect(getBlockchainCategory('kusama')).toBe('substrate');
      expect(getBlockchainCategory('bittensor')).toBe('substrate');
    });

    it('should return cosmos for Cosmos blockchains', () => {
      expect(getBlockchainCategory('injective')).toBe('cosmos');
    });

    it('should return utxo for Bitcoin', () => {
      expect(getBlockchainCategory('bitcoin')).toBe('utxo');
    });

    it('should return solana for Solana', () => {
      expect(getBlockchainCategory('solana')).toBe('solana');
    });

    it('should return other for unknown blockchains', () => {
      expect(getBlockchainCategory('unknown-chain')).toBe('other');
    });
  });

  describe('getBlockchainLayer', () => {
    it('should return 1 for Layer 1 blockchains', () => {
      expect(getBlockchainLayer('bitcoin')).toBe('1');
      expect(getBlockchainLayer('ethereum')).toBe('1');
    });

    it('should return 2 for Layer 2 blockchains', () => {
      expect(getBlockchainLayer('polygon')).toBe('2');
      expect(getBlockchainLayer('arbitrum-one')).toBe('2');
      expect(getBlockchainLayer('optimism-mainnet')).toBe('2');
      expect(getBlockchainLayer('base-mainnet')).toBe('2');
    });

    it('should return 0 for Layer 0 blockchains', () => {
      expect(getBlockchainLayer('polkadot')).toBe('0');
    });

    it('should return undefined for blockchains without layer info', () => {
      expect(getBlockchainLayer('solana')).toBeUndefined();
    });
  });

  describe('providerToSummary', () => {
    it('should convert provider to summary', () => {
      const provider = createMockProvider('test-provider', 'bitcoin', true, [
        'getAddressTransactions',
        'getAddressBalances',
      ]);

      const summary = providerToSummary(provider, false);

      expect(summary.name).toBe('test-provider');
      expect(summary.displayName).toBe('Test Provider');
      expect(summary.requiresApiKey).toBe(true);
      expect(summary.capabilities).toContain('txs');
      expect(summary.capabilities).toContain('balance');
    });

    it('should include rate limit when detailed is true', () => {
      const provider: ProviderInfo = {
        ...createMockProvider('test-provider', 'bitcoin'),
        defaultConfig: {
          rateLimit: {
            requestsPerSecond: 5,
            requestsPerMinute: 300,
          },
          retries: 3,
          timeout: 30000,
        },
      };

      const summary = providerToSummary(provider, true);

      expect(summary.rateLimit).toBe('5/sec');
    });

    it('should not include rate limit when detailed is false', () => {
      const provider: ProviderInfo = {
        ...createMockProvider('test-provider', 'bitcoin'),
        defaultConfig: {
          rateLimit: {
            requestsPerSecond: 5,
            requestsPerMinute: 300,
          },
          retries: 3,
          timeout: 30000,
        },
      };

      const summary = providerToSummary(provider, false);

      expect(summary.rateLimit).toBeUndefined();
    });

    it('should shorten operation names', () => {
      const provider = createMockProvider('test-provider', 'bitcoin', false, [
        'getAddressTransactions',
        'getAddressBalances',
      ]);

      const summary = providerToSummary(provider, false);

      expect(summary.capabilities).toContain('txs');
      expect(summary.capabilities).toContain('balance');
    });

    it('should handle getAddressTokenBalances as balance (Balance is checked before Token)', () => {
      // Note: getAddressTokenBalances contains both "Token" and "Balance"
      // The current implementation checks "Balance" first, so it returns "balance"
      const provider = createMockProvider('test-provider', 'ethereum', false, ['getAddressTokenBalances']);

      const summary = providerToSummary(provider, false);

      expect(summary.capabilities).toContain('balance');
    });
  });

  describe('buildBlockchainInfo', () => {
    it('should build blockchain info with providers', () => {
      const providers = [
        createMockProvider('provider1', 'bitcoin', true),
        createMockProvider('provider2', 'bitcoin', false),
      ];

      const info = buildBlockchainInfo('bitcoin', providers, false);

      expect(info.name).toBe('bitcoin');
      expect(info.displayName).toBe('Bitcoin');
      expect(info.category).toBe('utxo');
      expect(info.layer).toBe('1');
      expect(info.providers).toHaveLength(2);
      expect(info.providerCount).toBe(2);
      expect(info.requiresApiKey).toBe(true); // At least one requires API key
      expect(info.hasNoApiKeyProvider).toBe(true); // At least one doesn't require API key
      expect(info.exampleAddress).toBe('bc1q...');
    });

    it('should build blockchain info without providers', () => {
      const info = buildBlockchainInfo('ethereum', [], false);

      expect(info.name).toBe('ethereum');
      expect(info.displayName).toBe('Ethereum');
      expect(info.category).toBe('evm');
      expect(info.layer).toBe('1');
      expect(info.providers).toHaveLength(0);
      expect(info.providerCount).toBe(0);
      expect(info.requiresApiKey).toBe(false);
      expect(info.hasNoApiKeyProvider).toBe(false);
    });
  });

  describe('filterByCategory', () => {
    const mockBlockchains: BlockchainInfo[] = [
      createMockBlockchainInfo('bitcoin', 'utxo'),
      createMockBlockchainInfo('ethereum', 'evm'),
      createMockBlockchainInfo('polygon', 'evm'),
      createMockBlockchainInfo('solana', 'solana'),
    ];

    it('should filter by evm category', () => {
      const filtered = filterByCategory(mockBlockchains, 'evm');
      expect(filtered).toHaveLength(2);
      expect(filtered.map((b) => b.name)).toEqual(['ethereum', 'polygon']);
    });

    it('should filter by utxo category', () => {
      const filtered = filterByCategory(mockBlockchains, 'utxo');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe('bitcoin');
    });

    it('should return all blockchains when category is all', () => {
      const filtered = filterByCategory(mockBlockchains, 'all');
      expect(filtered).toHaveLength(4);
    });
  });

  describe('filterByApiKeyRequirement', () => {
    const mockBlockchains: BlockchainInfo[] = [
      { ...createMockBlockchainInfo('bitcoin', 'utxo'), requiresApiKey: true, hasNoApiKeyProvider: false },
      { ...createMockBlockchainInfo('ethereum', 'evm'), requiresApiKey: true, hasNoApiKeyProvider: true },
      { ...createMockBlockchainInfo('solana', 'solana'), requiresApiKey: false, hasNoApiKeyProvider: true },
    ];

    it('should filter blockchains that only require API key', () => {
      const filtered = filterByApiKeyRequirement(mockBlockchains, true);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe('bitcoin');
    });

    it('should filter blockchains with at least one no-API-key provider', () => {
      const filtered = filterByApiKeyRequirement(mockBlockchains, false);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((b) => b.name)).toEqual(['ethereum', 'solana']);
    });

    it('should return all blockchains when requiresApiKey is undefined', () => {
      const filtered = filterByApiKeyRequirement(mockBlockchains);
      expect(filtered).toHaveLength(3);
    });
  });

  describe('buildSummary', () => {
    it('should build summary with correct counts', () => {
      const blockchains: BlockchainInfo[] = [
        createMockBlockchainInfo('bitcoin', 'utxo'),
        createMockBlockchainInfo('ethereum', 'evm'),
        createMockBlockchainInfo('polygon', 'evm'),
      ];

      const allProviders: ProviderInfo[] = [
        createMockProvider('provider1', 'bitcoin', true),
        createMockProvider('provider2', 'ethereum', false),
        createMockProvider('provider3', 'polygon', true),
      ];

      const summary = buildSummary(blockchains, allProviders);

      expect(summary.totalBlockchains).toBe(3);
      expect(summary.totalProviders).toBe(3);
      expect(summary.byCategory).toEqual({ utxo: 1, evm: 2 });
      expect(summary.requireApiKey).toBe(2);
      expect(summary.noApiKey).toBe(1);
    });

    it('should handle empty blockchains', () => {
      const summary = buildSummary([], []);

      expect(summary.totalBlockchains).toBe(0);
      expect(summary.totalProviders).toBe(0);
      expect(summary.byCategory).toEqual({});
      expect(summary.requireApiKey).toBe(0);
      expect(summary.noApiKey).toBe(0);
    });
  });

  describe('sortBlockchains', () => {
    it('should sort blockchains by popularity order', () => {
      const blockchains: BlockchainInfo[] = [
        createMockBlockchainInfo('kusama', 'substrate'),
        createMockBlockchainInfo('bitcoin', 'utxo'),
        createMockBlockchainInfo('polygon', 'evm'),
        createMockBlockchainInfo('ethereum', 'evm'),
      ];

      const sorted = sortBlockchains(blockchains);

      expect(sorted.map((b) => b.name)).toEqual(['bitcoin', 'ethereum', 'polygon', 'kusama']);
    });

    it('should sort unknown blockchains alphabetically at the end', () => {
      const blockchains: BlockchainInfo[] = [
        createMockBlockchainInfo('zebra-chain', 'other'),
        createMockBlockchainInfo('bitcoin', 'utxo'),
        createMockBlockchainInfo('alpha-chain', 'other'),
      ];

      const sorted = sortBlockchains(blockchains);

      expect(sorted.map((b) => b.name)).toEqual(['bitcoin', 'alpha-chain', 'zebra-chain']);
    });
  });
});

// Helper functions to create mock data

function createMockProvider(
  name: string,
  blockchain: string,
  requiresApiKey = false,
  operations: ProviderOperationType[] = ['getAddressTransactions']
): ProviderInfo {
  return {
    name,
    displayName: name
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    blockchain,
    requiresApiKey,
    capabilities: {
      supportedOperations: operations,
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

function createMockBlockchainInfo(name: string, category: string): BlockchainInfo {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    category,
    providers: [],
    providerCount: 0,
    requiresApiKey: false,
    hasNoApiKeyProvider: false,
    exampleAddress: '0x...',
  };
}
