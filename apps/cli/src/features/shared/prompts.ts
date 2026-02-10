import confirm from '@inquirer/confirm';
import { ExitPromptError } from '@inquirer/core';

/**
 * Reusable prompt helpers for the CLI.
 */

/**
 * Handle cancellation by showing a message and exiting.
 */
export function handleCancellation(message = 'Operation cancelled'): never {
  console.error(message);
  process.exit(0);
}

/**
 * Prompt for confirmation.
 */
export async function promptConfirm(message: string, initialValue = true): Promise<boolean> {
  try {
    return await confirm({
      message,
      default: initialValue,
    });
  } catch (error) {
    // Only treat explicit user cancellation (Ctrl+C) as successful exit
    if (error instanceof ExitPromptError) {
      handleCancellation();
    }
    // Propagate other errors (prompt failures, I/O errors, etc.)
    throw error;
  }
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
  const evmChains = [
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
  ];

  if (evmChains.includes(name)) {
    if (name === 'ethereum') {
      return 'EVM • Layer 1';
    }

    const layer2Chains = ['arbitrum-one', 'base-mainnet', 'optimism-mainnet', 'polygon'];
    if (layer2Chains.includes(name)) {
      return 'EVM • Layer 2';
    }

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
 * Get address placeholder for blockchain.
 */
export function getAddressPlaceholder(blockchain: string): string {
  if (blockchain === 'bitcoin') return 'bc1q...';
  if (blockchain === 'ethereum' || blockchain.includes('evm')) return '0x742d35Cc...';
  if (blockchain === 'solana') return 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
  if (blockchain === 'polkadot' || blockchain === 'kusama') return '1...';
  return 'wallet address';
}
