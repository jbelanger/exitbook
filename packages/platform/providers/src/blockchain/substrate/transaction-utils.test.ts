import { describe, expect, it } from 'vitest';

import type { SubstrateChainConfig } from './chain-config.interface.ts';
import { augmentWithChainConfig } from './transaction-utils.ts';

describe('transaction-utils', () => {
  describe('augmentWithChainConfig', () => {
    it('should augment transactions with chain config', () => {
      const chainConfig: SubstrateChainConfig = {
        chainName: 'polkadot',
        displayName: 'Polkadot Relay Chain',
        nativeCurrency: 'DOT',
        nativeDecimals: 10,
        ss58Format: 0,
      };

      const transactions = [
        { hash: 'abc123', from: 'addr1', to: 'addr2' },
        { hash: 'def456', from: 'addr3', to: 'addr4' },
      ];

      const result = augmentWithChainConfig(transactions, chainConfig);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        hash: 'abc123',
        from: 'addr1',
        to: 'addr2',
        _nativeCurrency: 'DOT',
        _nativeDecimals: 10,
        _chainDisplayName: 'Polkadot Relay Chain',
      });
      expect(result[1]).toEqual({
        hash: 'def456',
        from: 'addr3',
        to: 'addr4',
        _nativeCurrency: 'DOT',
        _nativeDecimals: 10,
        _chainDisplayName: 'Polkadot Relay Chain',
      });
    });

    it('should handle empty array', () => {
      const chainConfig: SubstrateChainConfig = {
        chainName: 'polkadot',
        displayName: 'Polkadot Relay Chain',
        nativeCurrency: 'DOT',
        nativeDecimals: 10,
        ss58Format: 0,
      };

      const result = augmentWithChainConfig([], chainConfig);
      expect(result).toEqual([]);
    });
  });
});
