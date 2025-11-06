import * as p from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatBlockchainName,
  getAddressPlaceholder,
  getBlockchainHint,
  handleCancellation,
  isCancelled,
  sortBlockchainsByCategory,
} from '../prompts.js';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));

describe('prompts utilities', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    }) as never;
    vi.clearAllMocks();
  });

  afterEach(() => {
    processExitSpy.mockRestore();
  });

  describe('isCancelled', () => {
    it('should return true when value is a cancel symbol', () => {
      const cancelSymbol = Symbol('cancel');
      vi.mocked(p.isCancel).mockReturnValue(true);

      const result = isCancelled(cancelSymbol);

      expect(result).toBe(true);
      expect(p.isCancel).toHaveBeenCalledWith(cancelSymbol);
    });

    it('should return false when value is not a cancel symbol', () => {
      vi.mocked(p.isCancel).mockReturnValue(false);

      const result = isCancelled('some value');

      expect(result).toBe(false);
      expect(p.isCancel).toHaveBeenCalledWith('some value');
    });

    it('should work with various value types', () => {
      vi.mocked(p.isCancel).mockReturnValue(false);

      expect(isCancelled('string')).toBe(false);
      expect(isCancelled(123)).toBe(false);
      expect(isCancelled({ key: 'value' })).toBe(false);
    });
  });

  describe('handleCancellation', () => {
    it('should call p.cancel with default message and exit', () => {
      expect(() => handleCancellation()).toThrow('process.exit called');

      expect(p.cancel).toHaveBeenCalledWith('Operation cancelled');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should call p.cancel with custom message and exit', () => {
      expect(() => handleCancellation('Custom cancellation message')).toThrow('process.exit called');

      expect(p.cancel).toHaveBeenCalledWith('Custom cancellation message');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

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

  describe('sortBlockchainsByCategory', () => {
    it('should sort blockchains by popularity order', () => {
      const blockchains = ['kusama', 'bitcoin', 'polygon', 'ethereum', 'solana'];
      const sorted = sortBlockchainsByCategory(blockchains);

      expect(sorted).toEqual(['bitcoin', 'ethereum', 'solana', 'polygon', 'kusama']);
    });

    it('should place unknown blockchains at the end alphabetically', () => {
      const blockchains = ['unknown-z', 'bitcoin', 'unknown-a', 'ethereum'];
      const sorted = sortBlockchainsByCategory(blockchains);

      expect(sorted).toEqual(['bitcoin', 'ethereum', 'unknown-a', 'unknown-z']);
    });

    it('should handle all popular Layer 1 and Layer 2 chains', () => {
      const blockchains = [
        'base-mainnet',
        'arbitrum-one',
        'optimism-mainnet',
        'polygon',
        'solana',
        'ethereum',
        'bitcoin',
      ];
      const sorted = sortBlockchainsByCategory(blockchains);

      // Popular L1s first, then L2s
      expect(sorted[0]).toBe('bitcoin');
      expect(sorted[1]).toBe('ethereum');
      expect(sorted[2]).toBe('solana');
      expect(sorted.slice(3, 7)).toEqual(['polygon', 'arbitrum-one', 'optimism-mainnet', 'base-mainnet']);
    });

    it('should not mutate original array', () => {
      const original = ['polygon', 'bitcoin', 'ethereum'];
      const originalCopy = [...original];
      sortBlockchainsByCategory(original);

      expect(original).toEqual(originalCopy);
    });

    it('should handle empty array', () => {
      expect(sortBlockchainsByCategory([])).toEqual([]);
    });

    it('should handle single element', () => {
      expect(sortBlockchainsByCategory(['bitcoin'])).toEqual(['bitcoin']);
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
