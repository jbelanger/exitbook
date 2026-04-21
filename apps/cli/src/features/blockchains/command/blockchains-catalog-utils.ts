import { type BlockchainProviderDescriptor } from '@exitbook/blockchain-providers';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

import { formatBlockchainName, getAddressPlaceholder, getBlockchainHint } from '../../../cli/prompts.js';
import { providerToSummary, type ProviderSummary } from '../../providers/shared/provider-summary.js';
import type { BlockchainDisplayCategory } from '../blockchains-view-model.js';

export { providerToSummary, type ProviderSummary } from '../../providers/shared/provider-summary.js';

const BLOCKCHAIN_DISPLAY_CATEGORIES = ['evm', 'substrate', 'cosmos', 'utxo', 'solana', 'other'] as const;

export const BLOCKCHAIN_CATEGORIES = [...BLOCKCHAIN_DISPLAY_CATEGORIES, 'all'] as const;
export type BlockchainCategory = (typeof BLOCKCHAIN_CATEGORIES)[number];

export interface BlockchainCatalogItem {
  name: string;
  displayName: string;
  category: BlockchainDisplayCategory;
  layer?: string | undefined;
  providers: ProviderSummary[];
  providerCount: number;
  requiresApiKey: boolean;
  hasNoApiKeyProvider: boolean;
  exampleAddress: string;
}

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

export function getBlockchainCategory(blockchain: string): BlockchainDisplayCategory {
  const hint = getBlockchainHint(blockchain);

  if (hint.includes('EVM')) return 'evm';
  if (hint.includes('Substrate')) return 'substrate';
  if (hint.includes('Cosmos')) return 'cosmos';
  if (hint.includes('UTXO')) return 'utxo';
  if (hint.includes('TPS') || blockchain === 'solana') return 'solana';

  return 'other';
}

export function getBlockchainLayer(blockchain: string): string | undefined {
  const hint = getBlockchainHint(blockchain);

  if (hint.includes('Layer 0')) return '0';
  if (hint.includes('Layer 1')) return '1';
  if (hint.includes('Layer 2')) return '2';

  return undefined;
}

export function buildBlockchainCatalogItem(
  blockchain: string,
  providers: BlockchainProviderDescriptor[]
): BlockchainCatalogItem {
  const providerSummaries = providers.map((p) => providerToSummary(p));

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

export function filterByCategory(
  blockchains: BlockchainCatalogItem[],
  category: BlockchainCategory
): BlockchainCatalogItem[] {
  if (category === 'all') {
    return blockchains;
  }

  return blockchains.filter((b) => b.category === category);
}

export function filterByApiKeyRequirement(
  blockchains: BlockchainCatalogItem[],
  requiresApiKey?: boolean
): BlockchainCatalogItem[] {
  if (requiresApiKey === undefined) {
    return blockchains;
  }

  if (requiresApiKey) {
    return blockchains.filter((b) => b.requiresApiKey);
  } else {
    return blockchains.filter((b) => b.hasNoApiKeyProvider);
  }
}

export function sortBlockchains(blockchains: BlockchainCatalogItem[]): BlockchainCatalogItem[] {
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
