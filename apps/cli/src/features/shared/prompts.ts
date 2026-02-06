import * as p from '@clack/prompts';
import type { SourceType } from '@exitbook/core';
import { getAllBlockchains } from '@exitbook/ingestion';

/**
 * Reusable prompt helpers for the CLI.
 */

/**
 * Check if the operation was cancelled by the user.
 */
export function isCancelled<T>(value: T | symbol): value is symbol {
  return p.isCancel(value);
}

/**
 * Handle cancellation by showing a message and exiting.
 */
export function handleCancellation(message = 'Operation cancelled'): never {
  p.cancel(message);
  process.exit(0);
}

/**
 * Prompt for source type (exchange or blockchain).
 */
export async function promptSourceType(): Promise<SourceType> {
  const sourceType = await p.select({
    message: 'What would you like to import?',
    options: [
      { value: 'exchange' as const, label: 'Exchange', hint: 'Kraken, KuCoin, etc.' },
      { value: 'blockchain' as const, label: 'Blockchain', hint: 'Bitcoin, Ethereum, etc.' },
    ],
  });

  if (isCancelled(sourceType)) {
    handleCancellation();
  }

  return sourceType;
}

/**
 * Prompt for exchange selection.
 */
export async function promptExchange(): Promise<string> {
  const exchanges = ['kraken', 'kucoin', 'coinbase'];

  const exchange = await p.select({
    message: 'Select an exchange',
    options: exchanges.map((name: string) => ({
      value: name,
      label: formatExchangeName(name),
      hint: getExchangeHint(name),
    })),
  });

  if (isCancelled(exchange)) {
    handleCancellation();
  }

  return exchange;
}

/**
 * Prompt for blockchain selection with autocomplete.
 * Note: @clack/prompts select has built-in filtering when you type.
 */
export async function promptBlockchain(): Promise<string> {
  const blockchains = getAllBlockchains();

  // Sort blockchains by category and popularity
  const sortedBlockchains = sortBlockchainsByCategory(blockchains);

  const blockchain = await p.select({
    message: 'Select a blockchain (type to filter)',
    options: sortedBlockchains.map((name: string) => ({
      value: name,
      label: formatBlockchainName(name),
      hint: getBlockchainHint(name),
    })),
    maxItems: 10,
  });

  if (isCancelled(blockchain)) {
    handleCancellation();
  }

  return blockchain;
}

/**
 * Prompt for confirmation.
 */
export async function promptConfirm(message: string, initialValue = true): Promise<boolean> {
  const confirmed = await p.confirm({
    message,
    initialValue,
  });

  if (isCancelled(confirmed)) {
    handleCancellation();
  }

  return confirmed;
}

/**
 * Format exchange name for display.
 */
function formatExchangeName(name: string): string {
  const names: Record<string, string> = {
    kraken: 'Kraken',
    kucoin: 'KuCoin',
    coinbase: 'Coinbase',
  };
  return names[name] || name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Get exchange hint/description.
 */
function getExchangeHint(name: string): string {
  const hints: Record<string, string> = {
    kraken: 'CSV or API',
    kucoin: 'CSV or API',
    coinbase: 'API only',
  };
  return hints[name] ?? '';
}

/**
 * Format blockchain name for display.
 */
export function formatBlockchainName(name: string): string {
  const names: Record<string, string> = {
    bitcoin: 'Bitcoin',
    ethereum: 'Ethereum',
    'avalanche-c': 'Avalanche C-Chain',
    'avalanche-p': 'Avalanche P-Chain',
    'avalanche-x': 'Avalanche X-Chain',
    polygon: 'Polygon',
    'arbitrum-one': 'Arbitrum One',
    'optimism-mainnet': 'Optimism',
    'base-mainnet': 'Base',
    bsc: 'BNB Smart Chain',
    polkadot: 'Polkadot',
    kusama: 'Kusama',
    bittensor: 'Bittensor (TAO)',
    solana: 'Solana',
    injective: 'Injective',
  };
  return (
    names[name] ??
    name
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

/**
 * Get blockchain category hint.
 */
export function getBlockchainHint(name: string): string {
  // EVM chains
  if (
    [
      'arbitrum-one',
      'avalanche-c',
      'base-mainnet',
      'blast',
      'bsc',
      'ethereum',
      'linea',
      'mantle',
      'optimism-mainnet',
      'polygon',
      'scroll',
      'theta',
      'zksync',
    ].includes(name)
  ) {
    if (name === 'ethereum') return 'EVM • Layer 1';
    if (['arbitrum-one', 'base-mainnet', 'optimism-mainnet', 'polygon'].includes(name)) return 'EVM • Layer 2';
    return 'EVM';
  }

  // Substrate chains
  if (['astar', 'bittensor', 'kusama', 'moonbeam', 'polkadot'].includes(name)) {
    if (name === 'polkadot') return 'Substrate • Layer 0';
    if (name === 'bittensor') return 'Substrate • AI';
    return 'Substrate';
  }

  // Cosmos chains
  if (['cosmos', 'injective', 'osmosis'].includes(name)) {
    return 'Cosmos SDK';
  }

  // Others
  if (name === 'bitcoin') return 'UTXO • Layer 1';
  if (name === 'solana') return 'High TPS';

  return '';
}

/**
 * Sort blockchains by category and popularity.
 */
export function sortBlockchainsByCategory(blockchains: string[]): string[] {
  const order = [
    // Popular Layer 1s first
    'bitcoin',
    'ethereum',
    'solana',
    // Popular Layer 2s
    'polygon',
    'arbitrum-one',
    'optimism-mainnet',
    'base-mainnet',
    // Other EVM chains
    'avalanche-c',
    'bsc',
    // Substrate
    'polkadot',
    'kusama',
    'bittensor',
    // Cosmos
    'injective',
  ];

  const sorted = [...blockchains].sort((a, b) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);

    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  return sorted;
}

/**
 * Get address placeholder for blockchain.
 */
export function getAddressPlaceholder(blockchain: string): string {
  if (blockchain === 'bitcoin') return 'bc1q...';
  if (blockchain === 'ethereum' || blockchain.includes('evm')) return '0x742d35Cc...';
  if (blockchain === 'solana') return 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
  if (blockchain === 'polkadot' || blockchain === 'kusama') return '1...';
  return 'wallet address';
}
