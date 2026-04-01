import pc from 'picocolors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfirm, MockExitPromptError } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  MockExitPromptError: class MockExitPromptError extends Error {},
}));

vi.mock('@inquirer/confirm', () => ({
  default: mockConfirm,
}));

vi.mock('@inquirer/core', () => ({
  ExitPromptError: MockExitPromptError,
}));

import { formatBlockchainName, getAddressPlaceholder, getBlockchainHint, promptConfirmDecision } from '../prompts.js';

describe('prompts utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('promptConfirmDecision', () => {
    it('passes a neutral prompt theme to inquirer confirm', async () => {
      mockConfirm.mockResolvedValue(true);

      await expect(promptConfirmDecision('Delete account foo?', false)).resolves.toBe('confirmed');

      expect(mockConfirm).toHaveBeenCalledWith({
        message: 'Delete account foo?',
        default: false,
        theme: {
          prefix: {
            idle: pc.dim('›'),
            done: pc.dim('›'),
          },
        },
      });
    });

    it('maps interrupted prompts to cancelled', async () => {
      mockConfirm.mockRejectedValue(new MockExitPromptError('cancelled'));

      await expect(promptConfirmDecision('Delete account foo?', false)).resolves.toBe('cancelled');
    });
  });

  describe('formatBlockchainName', () => {
    it('formats known blockchain names correctly', () => {
      expect(formatBlockchainName('bitcoin')).toBe('Bitcoin');
      expect(formatBlockchainName('ethereum')).toBe('Ethereum');
      expect(formatBlockchainName('polygon')).toBe('Polygon');
      expect(formatBlockchainName('bsc')).toBe('BNB Smart Chain');
    });

    it('formats Avalanche chains correctly', () => {
      expect(formatBlockchainName('avalanche-c')).toBe('Avalanche C-Chain');
      expect(formatBlockchainName('avalanche-p')).toBe('Avalanche P-Chain');
      expect(formatBlockchainName('avalanche-x')).toBe('Avalanche X-Chain');
    });

    it('formats layer 2 chains correctly', () => {
      expect(formatBlockchainName('arbitrum-one')).toBe('Arbitrum One');
      expect(formatBlockchainName('optimism-mainnet')).toBe('Optimism');
      expect(formatBlockchainName('base-mainnet')).toBe('Base');
    });

    it('formats unknown chains by capitalizing words', () => {
      expect(formatBlockchainName('unknown-chain')).toBe('Unknown Chain');
      expect(formatBlockchainName('new-blockchain')).toBe('New Blockchain');
    });

    it('handles single-word unknown chains', () => {
      expect(formatBlockchainName('newchain')).toBe('Newchain');
    });
  });

  describe('getBlockchainHint', () => {
    it('returns the correct hint for Bitcoin', () => {
      expect(getBlockchainHint('bitcoin')).toBe('UTXO • Layer 1');
    });

    it('returns the correct hint for Ethereum', () => {
      expect(getBlockchainHint('ethereum')).toBe('EVM • Layer 1');
    });

    it('returns the correct hint for layer 2 chains', () => {
      expect(getBlockchainHint('arbitrum-one')).toBe('EVM • Layer 2');
      expect(getBlockchainHint('optimism-mainnet')).toBe('EVM • Layer 2');
      expect(getBlockchainHint('base-mainnet')).toBe('EVM • Layer 2');
      expect(getBlockchainHint('polygon')).toBe('EVM • Layer 2');
    });

    it('returns the correct hint for other EVM chains', () => {
      expect(getBlockchainHint('avalanche-c')).toBe('EVM');
      expect(getBlockchainHint('bsc')).toBe('EVM');
      expect(getBlockchainHint('linea')).toBe('EVM');
      expect(getBlockchainHint('zksync')).toBe('EVM');
    });

    it('returns the correct hint for substrate chains', () => {
      expect(getBlockchainHint('polkadot')).toBe('Substrate • Layer 0');
      expect(getBlockchainHint('bittensor')).toBe('Substrate • AI');
      expect(getBlockchainHint('kusama')).toBe('Substrate');
      expect(getBlockchainHint('moonbeam')).toBe('Substrate');
    });

    it('returns the correct hint for Cosmos chains', () => {
      expect(getBlockchainHint('injective')).toBe('Cosmos SDK');
    });

    it('returns the correct hint for Solana', () => {
      expect(getBlockchainHint('solana')).toBe('High TPS');
    });

    it('returns an empty string for unknown chains', () => {
      expect(getBlockchainHint('unknown-chain')).toBe('');
    });
  });

  describe('getAddressPlaceholder', () => {
    it('returns the correct placeholder for Bitcoin', () => {
      expect(getAddressPlaceholder('bitcoin')).toBe('bc1q...');
    });

    it('returns the correct placeholder for Ethereum', () => {
      expect(getAddressPlaceholder('ethereum')).toBe('0x742d35Cc...');
    });

    it('returns the generic placeholder for EVM chains without evm in the name', () => {
      expect(getAddressPlaceholder('polygon')).toBe('wallet address');
      expect(getAddressPlaceholder('arbitrum-one')).toBe('wallet address');
      expect(getAddressPlaceholder('bsc')).toBe('wallet address');
    });

    it('returns the correct placeholder for Solana', () => {
      expect(getAddressPlaceholder('solana')).toBe('DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK');
    });

    it('returns the correct placeholder for Polkadot and Kusama', () => {
      expect(getAddressPlaceholder('polkadot')).toBe('1...');
      expect(getAddressPlaceholder('kusama')).toBe('1...');
    });

    it('returns the generic placeholder for unknown chains', () => {
      expect(getAddressPlaceholder('unknown-chain')).toBe('wallet address');
    });

    it('handles chains with evm in the name', () => {
      expect(getAddressPlaceholder('some-evm-chain')).toBe('0x742d35Cc...');
    });
  });
});
