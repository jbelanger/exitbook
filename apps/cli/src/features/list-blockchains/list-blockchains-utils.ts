// Pure utility functions for list-blockchains command
// All functions are pure - no side effects

import type { ProviderInfo } from '@exitbook/blockchain-providers';
import { ProviderRegistry } from '@exitbook/blockchain-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { formatBlockchainName, getAddressPlaceholder, getBlockchainHint } from '../shared/prompts.js';

/**
 * CLI options structure for list-blockchains command.
 */
export interface ListBlockchainsCommandOptions {
  category?: string | undefined;
  detailed?: boolean | undefined;
  requiresApiKey?: boolean | undefined;
}

/**
 * Blockchain categories for filtering.
 */
export const BLOCKCHAIN_CATEGORIES = ['evm', 'substrate', 'cosmos', 'utxo', 'solana', 'all'] as const;
export type BlockchainCategory = (typeof BLOCKCHAIN_CATEGORIES)[number];

/**
 * Blockchain information with providers.
 */
export interface BlockchainInfo {
  name: string;
  displayName: string;
  category: string;
  layer?: string | undefined;
  providers: ProviderSummary[];
  providerCount: number;
  requiresApiKey: boolean; // true if ANY provider requires API key
  hasNoApiKeyProvider: boolean; // true if ANY provider doesn't require API key
  exampleAddress: string;
}

/**
 * Provider summary information.
 */
export interface ProviderSummary {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string | undefined;
  capabilities: string[];
  rateLimit?: string | undefined;
}

/**
 * Summary statistics.
 */
export interface BlockchainListSummary {
  totalBlockchains: number;
  totalProviders: number;
  byCategory: Record<string, number>;
  requireApiKey: number;
  noApiKey: number;
}

/**
 * Validate blockchain category filter.
 */
export function validateCategory(category: string): Result<BlockchainCategory, Error> {
  if (!BLOCKCHAIN_CATEGORIES.includes(category as BlockchainCategory)) {
    return err(
      new Error(
        `Invalid category: ${category}. Supported: ${BLOCKCHAIN_CATEGORIES.filter((c) => c !== 'all').join(', ')}`
      )
    );
  }
  return ok(category as BlockchainCategory);
}

/**
 * Get blockchain category from name.
 * Derives category from the blockchain hint in shared prompts.
 */
export function getBlockchainCategory(blockchain: string): string {
  const hint = getBlockchainHint(blockchain);

  if (hint.includes('EVM')) return 'evm';
  if (hint.includes('Substrate')) return 'substrate';
  if (hint.includes('Cosmos')) return 'cosmos';
  if (hint.includes('UTXO')) return 'utxo';
  if (hint.includes('TPS') || blockchain === 'solana') return 'solana';

  return 'other';
}

/**
 * Get blockchain layer information from hint.
 */
export function getBlockchainLayer(blockchain: string): string | undefined {
  const hint = getBlockchainHint(blockchain);

  if (hint.includes('Layer 0')) return '0';
  if (hint.includes('Layer 1')) return '1';
  if (hint.includes('Layer 2')) return '2';

  return undefined;
}

/**
 * Convert provider info to summary.
 */
export function providerToSummary(provider: ProviderInfo, detailed: boolean): ProviderSummary {
  // Shorten operation names for display
  const capabilities = Array.from(
    new Set(
      provider.capabilities.supportedOperations.map((op) => {
        if (op.includes('Balance')) return 'balance';
        if (op.includes('Transaction')) return 'txs';
        if (op.includes('Withdrawal')) return 'withdrawals';
        if (op.includes('Token')) return 'tokens';
        return op;
      })
    )
  );

  const summary: ProviderSummary = {
    name: provider.name,
    displayName: provider.displayName,
    requiresApiKey: provider.requiresApiKey,
    capabilities,
  };

  if (detailed && provider.defaultConfig?.rateLimit) {
    const rl = provider.defaultConfig.rateLimit;
    summary.rateLimit = `${rl.requestsPerSecond}/sec`;
  }

  if (provider.requiresApiKey) {
    // Get API key env var from provider metadata
    const metadata = ProviderRegistry.getMetadata(provider.blockchain, provider.name);
    if (metadata?.apiKeyEnvVar) {
      summary.apiKeyEnvVar = metadata.apiKeyEnvVar;
    }
  }

  return summary;
}

/**
 * Build blockchain info from name and providers.
 */
export function buildBlockchainInfo(blockchain: string, providers: ProviderInfo[], detailed: boolean): BlockchainInfo {
  const providerSummaries = providers.map((p) => providerToSummary(p, detailed));

  return {
    name: blockchain,
    displayName: formatBlockchainName(blockchain),
    category: getBlockchainCategory(blockchain),
    layer: getBlockchainLayer(blockchain),
    providers: providerSummaries,
    providerCount: providers.length,
    requiresApiKey: providers.some((p) => p.requiresApiKey),
    hasNoApiKeyProvider: providers.some((p) => !p.requiresApiKey),
    exampleAddress: getAddressPlaceholder(blockchain),
  };
}

/**
 * Filter blockchains by category.
 */
export function filterByCategory(blockchains: BlockchainInfo[], category: BlockchainCategory): BlockchainInfo[] {
  if (category === 'all') {
    return blockchains;
  }

  return blockchains.filter((b) => b.category === category);
}

/**
 * Filter blockchains by API key requirement.
 */
export function filterByApiKeyRequirement(blockchains: BlockchainInfo[], requiresApiKey?: boolean): BlockchainInfo[] {
  if (requiresApiKey === undefined) {
    return blockchains;
  }

  if (requiresApiKey) {
    // Only show blockchains where ALL providers require API key
    return blockchains.filter((b) => b.requiresApiKey && !b.hasNoApiKeyProvider);
  } else {
    // Only show blockchains with at least one provider that doesn't require API key
    return blockchains.filter((b) => b.hasNoApiKeyProvider);
  }
}

/**
 * Build summary statistics.
 */
export function buildSummary(blockchains: BlockchainInfo[], allProviders: ProviderInfo[]): BlockchainListSummary {
  const byCategory: Record<string, number> = {};

  for (const blockchain of blockchains) {
    byCategory[blockchain.category] = (byCategory[blockchain.category] || 0) + 1;
  }

  return {
    totalBlockchains: blockchains.length,
    totalProviders: allProviders.length,
    byCategory,
    requireApiKey: allProviders.filter((p) => p.requiresApiKey).length,
    noApiKey: allProviders.filter((p) => !p.requiresApiKey).length,
  };
}

/**
 * Sort blockchains by category and popularity.
 */
export function sortBlockchains(blockchains: BlockchainInfo[]): BlockchainInfo[] {
  const order = [
    'bitcoin',
    'ethereum',
    'solana',
    'polygon',
    'arbitrum-one',
    'optimism-mainnet',
    'base-mainnet',
    'avalanche-c',
    'bsc',
    'polkadot',
    'kusama',
    'bittensor',
    'injective',
  ];

  return [...blockchains].sort((a, b) => {
    const indexA = order.indexOf(a.name);
    const indexB = order.indexOf(b.name);

    if (indexA === -1 && indexB === -1) return a.name.localeCompare(b.name);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}
