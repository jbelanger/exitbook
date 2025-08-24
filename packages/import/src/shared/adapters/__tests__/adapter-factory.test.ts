import type { UniversalExchangeAdapterConfig } from '@crypto/core';
import { describe, expect, it } from 'vitest';

import { UniversalAdapterFactory } from '../adapter-factory.ts';

describe('UniversalAdapterFactory', () => {
  describe('Native Exchange Adapters', () => {
    it('should create native Coinbase adapter', async () => {
      const config: UniversalExchangeAdapterConfig = {
        type: 'exchange',
        id: 'coinbase',
        subType: 'native',
        credentials: {
          apiKey: 'organizations/test-org/apiKeys/test-key',
          secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHTestTestKey\n-----END EC PRIVATE KEY-----',
          password: 'test-passphrase',
        },
      };

      const adapter = await UniversalAdapterFactory.create(config);

      expect(adapter).toBeDefined();

      const info = await adapter.getInfo();
      expect(info).toEqual({
        id: 'coinbase',
        name: 'Coinbase Track API',
        type: 'exchange',
        subType: 'native',
        capabilities: {
          supportedOperations: ['fetchTransactions', 'fetchBalances'],
          maxBatchSize: 100,
          supportsHistoricalData: true,
          supportsPagination: true,
          requiresApiKey: true,
          rateLimit: {
            requestsPerSecond: 3,
            burstLimit: 5,
          },
        },
      });

      await adapter.close();
    });

    it('should throw error for unsupported native exchange', async () => {
      const config: UniversalExchangeAdapterConfig = {
        type: 'exchange',
        id: 'unsupported',
        subType: 'native',
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
        },
      };

      await expect(UniversalAdapterFactory.create(config)).rejects.toThrow('Unsupported native exchange: unsupported');
    });

    it('should throw error for native adapter without credentials', async () => {
      const config: UniversalExchangeAdapterConfig = {
        type: 'exchange',
        id: 'coinbase',
        subType: 'native',
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
          secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHTestTestKey\n-----END EC PRIVATE KEY-----',
          password: 'test-passphrase',
        },
      });

      expect(config).toEqual({
        type: 'exchange',
        id: 'coinbase',
        subType: 'native',
        credentials: {
          apiKey: 'organizations/test-org/apiKeys/test-key',
          secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHTestTestKey\n-----END EC PRIVATE KEY-----',
          password: 'test-passphrase',
        },
        csvDirectories: undefined,
      });
    });
  });
});
