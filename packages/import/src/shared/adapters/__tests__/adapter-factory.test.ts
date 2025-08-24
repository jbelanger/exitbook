import type { UniversalExchangeAdapterConfig } from '@crypto/core';
import { describe, expect, it } from 'vitest';

import { UniversalAdapterFactory } from '../adapter-factory.ts';

describe('UniversalAdapterFactory', () => {
  describe('Native Exchange Adapters', () => {
    it('should create native Coinbase adapter', async () => {
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

      const adapter = await UniversalAdapterFactory.create(config);

      expect(adapter).toBeDefined();

      const info = await adapter.getInfo();
      expect(info).toEqual({
        capabilities: {
          maxBatchSize: 100,
          rateLimit: {
            burstLimit: 5,
            requestsPerSecond: 3,
          },
          requiresApiKey: true,
          supportedOperations: ['fetchTransactions', 'fetchBalances'],
          supportsHistoricalData: true,
          supportsPagination: true,
        },
        id: 'coinbase',
        name: 'Coinbase Track API',
        subType: 'native',
        type: 'exchange',
      });

      await adapter.close();
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
