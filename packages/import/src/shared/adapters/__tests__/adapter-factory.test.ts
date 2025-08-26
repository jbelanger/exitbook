import type { UniversalExchangeAdapterConfig } from '@crypto/core';
import { describe, expect, it } from 'vitest';

import { UniversalAdapterFactory } from '../adapter-factory.ts';

describe('UniversalAdapterFactory', () => {
  describe('Native Exchange Adapters', () => {
    it('should throw error for unsupported native Coinbase adapter', async () => {
      // Coinbase uses importer/processor pattern, not native adapter
      const config: UniversalExchangeAdapterConfig = {
        credentials: {
          apiKey: 'organizations/test-org/apiKeys/test-key',
          password: 'test-passphrase',
          secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHTestTestKey\n-----END EC PRIVATE KEY-----',
        },
        id: 'coinbase',
        subType: 'native',
        type: 'exchange',
      };

      await expect(UniversalAdapterFactory.create(config)).rejects.toThrow('Unsupported native exchange: coinbase');
    });

    it('should throw error for unsupported native exchange', async () => {
      const config: UniversalExchangeAdapterConfig = {
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
        },
        id: 'unsupported',
        subType: 'native',
        type: 'exchange',
      };

      await expect(UniversalAdapterFactory.create(config)).rejects.toThrow('Unsupported native exchange: unsupported');
    });

    it('should throw error for native adapter without credentials', async () => {
      const config: UniversalExchangeAdapterConfig = {
        id: 'coinbase',
        subType: 'native',
        type: 'exchange',
      };

      await expect(UniversalAdapterFactory.create(config)).rejects.toThrow(
        'Credentials required for native exchange adapters'
      );
    });
  });

  describe('createExchangeConfig helper', () => {
    it('should create native exchange config', () => {
      const config = UniversalAdapterFactory.createExchangeConfig('coinbase', 'native', {
        credentials: {
          apiKey: 'organizations/test-org/apiKeys/test-key',
          password: 'test-passphrase',
          secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHTestTestKey\n-----END EC PRIVATE KEY-----',
        },
      });

      expect(config).toEqual({
        credentials: {
          apiKey: 'organizations/test-org/apiKeys/test-key',
          password: 'test-passphrase',
          secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHTestTestKey\n-----END EC PRIVATE KEY-----',
        },
        csvDirectories: undefined,
        id: 'coinbase',
        subType: 'native',
        type: 'exchange',
      });
    });
  });
});
