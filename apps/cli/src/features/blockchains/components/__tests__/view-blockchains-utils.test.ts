import type { ProviderInfo, ProviderOperationType } from '@exitbook/blockchain-providers';
import { describe, expect, it } from 'vitest';

import type { BlockchainInfo } from '../../blockchains-view-utils.js';
import {
  buildBlockchainInfo,
  filterByApiKeyRequirement,
  filterByCategory,
  getBlockchainCategory,
  getBlockchainLayer,
  providerToSummary,
  sortBlockchains,
  toBlockchainViewItem,
  validateCategory,
} from '../../blockchains-view-utils.js';

describe('view-blockchains-utils', () => {
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

      const summary = providerToSummary(provider);

      expect(summary.name).toBe('test-provider');
      expect(summary.displayName).toBe('Test Provider');
      expect(summary.requiresApiKey).toBe(true);
      expect(summary.capabilities).toContain('txs');
      expect(summary.capabilities).toContain('balance');
    });

    it('should always include rate limit', () => {
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

      const summary = providerToSummary(provider);

      expect(summary.rateLimit).toBe('5/sec');
    });

    it('should shorten operation names', () => {
      const provider = createMockProvider('test-provider', 'bitcoin', false, [
        'getAddressTransactions',
        'getAddressBalances',
      ]);

      const summary = providerToSummary(provider);

      expect(summary.capabilities).toContain('txs');
      expect(summary.capabilities).toContain('balance');
    });

    it('should handle getAddressTokenBalances as balance (Balance is checked before Token)', () => {
      const provider = createMockProvider('test-provider', 'ethereum', false, ['getAddressTokenBalances']);

      const summary = providerToSummary(provider);

      expect(summary.capabilities).toContain('balance');
    });
  });

  describe('buildBlockchainInfo', () => {
    it('should build blockchain info with providers', () => {
      const providers = [
        createMockProvider('provider1', 'bitcoin', true),
        createMockProvider('provider2', 'bitcoin', false),
      ];

      const info = buildBlockchainInfo('bitcoin', providers);

      expect(info.name).toBe('bitcoin');
      expect(info.displayName).toBe('Bitcoin');
      expect(info.category).toBe('utxo');
      expect(info.layer).toBe('1');
      expect(info.providers).toHaveLength(2);
      expect(info.providerCount).toBe(2);
      expect(info.requiresApiKey).toBe(true);
      expect(info.hasNoApiKeyProvider).toBe(true);
      expect(info.exampleAddress).toBe('bc1q...');
    });

    it('should build blockchain info without providers', () => {
      const info = buildBlockchainInfo('ethereum', []);

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

  describe('toBlockchainViewItem', () => {
    it('should compute none-needed when no providers require API keys', () => {
      const blockchain: BlockchainInfo = {
        ...createMockBlockchainInfo('bitcoin', 'utxo'),
        providers: [
          { name: 'mempool', displayName: 'Mempool', requiresApiKey: false, capabilities: ['txs'], rateLimit: '5/sec' },
        ],
        providerCount: 1,
      };

      const item = toBlockchainViewItem(blockchain);

      expect(item.keyStatus).toBe('none-needed');
      expect(item.missingKeyCount).toBe(0);
      expect(item.providers[0]!.apiKeyConfigured).toBeUndefined();
    });

    it('should compute some-missing when env var is not set', () => {
      const blockchain: BlockchainInfo = {
        ...createMockBlockchainInfo('ethereum', 'evm'),
        providers: [
          {
            name: 'alchemy',
            displayName: 'Alchemy',
            requiresApiKey: true,
            apiKeyEnvVar: 'TEST_NONEXISTENT_KEY_12345',
            capabilities: ['txs', 'balance'],
            rateLimit: '5/sec',
          },
        ],
        providerCount: 1,
        requiresApiKey: true,
      };

      const item = toBlockchainViewItem(blockchain);

      expect(item.keyStatus).toBe('some-missing');
      expect(item.missingKeyCount).toBe(1);
      expect(item.providers[0]!.apiKeyConfigured).toBe(false);
    });

    it('should preserve blockchain metadata in view item', () => {
      const blockchain: BlockchainInfo = {
        ...createMockBlockchainInfo('polygon', 'evm'),
        layer: '2',
        exampleAddress: '0x742d35Cc...',
      };

      const item = toBlockchainViewItem(blockchain);

      expect(item.name).toBe('polygon');
      expect(item.displayName).toBe('Polygon');
      expect(item.category).toBe('evm');
      expect(item.layer).toBe('2');
      expect(item.exampleAddress).toBe('0x742d35Cc...');
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
