import { describe, expect, it } from 'vitest';

import { formatBlockchainName, getAddressPlaceholder, getBlockchainHint } from '../prompts.js';

describe('prompts utilities', () => {
  describe('formatBlockchainName', () => {
    it('should format known blockchain names correctly', () => {
      expect(formatBlockchainName('bitcoin')).toBe('Bitcoin');
      expect(formatBlockchainName('ethereum')).toBe('Ethereum');
      expect(formatBlockchainName('polygon')).toBe('Polygon');
      expect(formatBlockchainName('bsc')).toBe('BNB Smart Chain');
    });

    it('should format Avalanche chains correctly', () => {
      expect(formatBlockchainName('avalanche-c')).toBe('Avalanche C-Chain');
      expect(formatBlockchainName('avalanche-p')).toBe('Avalanche P-Chain');
      expect(formatBlockchainName('avalanche-x')).toBe('Avalanche X-Chain');
    });

    it('should format Layer 2 chains correctly', () => {
      expect(formatBlockchainName('arbitrum-one')).toBe('Arbitrum One');
      expect(formatBlockchainName('optimism-mainnet')).toBe('Optimism');
      expect(formatBlockchainName('base-mainnet')).toBe('Base');
    });

    it('should format unknown chains by capitalizing words', () => {
      expect(formatBlockchainName('unknown-chain')).toBe('Unknown Chain');
      expect(formatBlockchainName('new-blockchain')).toBe('New Blockchain');
    });

    it('should handle single-word unknown chains', () => {
      expect(formatBlockchainName('newchain')).toBe('Newchain');
    });
  });

  describe('getBlockchainHint', () => {
    it('should return correct hint for Bitcoin', () => {
      expect(getBlockchainHint('bitcoin')).toBe('UTXO • Layer 1');
    });

    it('should return correct hint for Ethereum', () => {
      expect(getBlockchainHint('ethereum')).toBe('EVM • Layer 1');
    });

    it('should return correct hint for Layer 2 chains', () => {
      expect(getBlockchainHint('arbitrum-one')).toBe('EVM • Layer 2');
      expect(getBlockchainHint('optimism-mainnet')).toBe('EVM • Layer 2');
      expect(getBlockchainHint('base-mainnet')).toBe('EVM • Layer 2');
      expect(getBlockchainHint('polygon')).toBe('EVM • Layer 2');
    });

    it('should return correct hint for other EVM chains', () => {
      expect(getBlockchainHint('bsc')).toBe('EVM');
      expect(getBlockchainHint('avalanche-c')).toBe('EVM');
      expect(getBlockchainHint('linea')).toBe('EVM');
      expect(getBlockchainHint('zksync')).toBe('EVM');
    });

    it('should return correct hint for Substrate chains', () => {
      expect(getBlockchainHint('polkadot')).toBe('Substrate • Layer 0');
      expect(getBlockchainHint('bittensor')).toBe('Substrate • AI');
      expect(getBlockchainHint('kusama')).toBe('Substrate');
      expect(getBlockchainHint('moonbeam')).toBe('Substrate');
    });

    it('should return correct hint for Cosmos chains', () => {
      expect(getBlockchainHint('injective')).toBe('Cosmos SDK');
    });

    it('should return correct hint for Solana', () => {
      expect(getBlockchainHint('solana')).toBe('High TPS');
    });

    it('should return empty string for unknown chains', () => {
      expect(getBlockchainHint('unknown-chain')).toBe('');
    });
  });

  describe('getAddressPlaceholder', () => {
    it('should return correct placeholder for Bitcoin', () => {
      expect(getAddressPlaceholder('bitcoin')).toBe('bc1q...');
    });

    it('should return correct placeholder for Ethereum', () => {
      expect(getAddressPlaceholder('ethereum')).toBe('0x742d35Cc...');
    });

    it('should return generic placeholder for EVM chains without evm in name', () => {
      // These are EVM chains but don't have 'evm' in their name
      // So they get the generic placeholder
      expect(getAddressPlaceholder('polygon')).toBe('wallet address');
      expect(getAddressPlaceholder('arbitrum-one')).toBe('wallet address');
      expect(getAddressPlaceholder('bsc')).toBe('wallet address');
    });

    it('should return correct placeholder for Solana', () => {
      expect(getAddressPlaceholder('solana')).toBe('DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK');
    });

    it('should return correct placeholder for Polkadot/Kusama', () => {
      expect(getAddressPlaceholder('polkadot')).toBe('1...');
      expect(getAddressPlaceholder('kusama')).toBe('1...');
    });

    it('should return generic placeholder for unknown chains', () => {
      expect(getAddressPlaceholder('unknown-chain')).toBe('wallet address');
    });

    it('should handle chains with evm in the name', () => {
      expect(getAddressPlaceholder('some-evm-chain')).toBe('0x742d35Cc...');
    });
  });
});
