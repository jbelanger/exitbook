import { render } from 'ink';
import React from 'react';

import {
  ConfirmPrompt,
  PromptFlow,
  type PromptStep,
  SelectPrompt,
  type SelectOption,
  TextPrompt,
} from '../ui/shared/prompts.js';

export type ConfirmationPromptDecision = 'cancelled' | 'confirmed' | 'declined';

export { SelectPrompt, type SelectOption, TextPrompt };
export type { PromptStep };

interface PromptFlowOptions {
  steps: PromptStep[];
  title?: string | undefined;
}

type PromptResult<T> = { kind: 'cancelled' } | { kind: 'submitted'; value: T };

function runPromptSession<T>(
  buildPrompt: (handlers: { onCancel: () => void; onSubmit: (value: T) => void }) => React.ReactElement
): Promise<PromptResult<T>> {
  return new Promise<PromptResult<T>>((resolve) => {
    let isSettled = false;
    let unmount: (error?: number | Error | null) => void = () => void 0;

    const settle = (result: PromptResult<T>): void => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      unmount();
      resolve(result);
    };

    const prompt = buildPrompt({
      onCancel: () => settle({ kind: 'cancelled' }),
      onSubmit: (value) => settle({ kind: 'submitted', value }),
    });

    ({ unmount } = render(prompt));
  });
}

export async function promptConfirmDecision(message: string, initialValue = true): Promise<ConfirmationPromptDecision> {
  const result = await runPromptSession<boolean>(({ onCancel, onSubmit }) =>
    React.createElement(ConfirmPrompt, {
      initialValue,
      message,
      onCancel,
      onSubmit,
    })
  );

  if (result.kind === 'cancelled') {
    return 'cancelled';
  }

  return result.value ? 'confirmed' : 'declined';
}

export async function promptFlowAnswers({
  title,
  steps,
}: PromptFlowOptions): Promise<(boolean | string)[] | undefined> {
  const result = await runPromptSession<(boolean | string)[]>(({ onCancel, onSubmit }) =>
    React.createElement(
      PromptFlow,
      title === undefined
        ? {
            onCancel,
            onComplete: onSubmit,
            steps,
          }
        : {
            onCancel,
            onComplete: onSubmit,
            steps,
            title,
          }
    )
  );

  return result.kind === 'cancelled' ? undefined : result.value;
}

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
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

export function getBlockchainHint(name: string): string {
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

  if (['astar', 'bittensor', 'kusama', 'moonbeam', 'polkadot'].includes(name)) {
    if (name === 'polkadot') return 'Substrate • Layer 0';
    if (name === 'bittensor') return 'Substrate • AI';
    return 'Substrate';
  }

  if (['cosmos', 'injective', 'osmosis'].includes(name)) {
    return 'Cosmos SDK';
  }

  if (name === 'bitcoin') return 'UTXO • Layer 1';
  if (name === 'solana') return 'High TPS';

  return '';
}

export function getAddressPlaceholder(blockchain: string): string {
  if (blockchain === 'bitcoin') return 'bc1q...';
  if (blockchain === 'ethereum' || blockchain.includes('evm')) return '0x742d35Cc...';
  if (blockchain === 'solana') return 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
  if (blockchain === 'polkadot' || blockchain === 'kusama') return '1...';
  return 'wallet address';
}
