import { describe, it, expect } from 'vitest';

import { createProviderRegistry } from '../../../../../initialize.js';

describe('XrplRpcApiClient', () => {
  const providerRegistry = createProviderRegistry();

  describe('Registration', () => {
    it('should be registered in the provider registry', () => {
      const metadata = providerRegistry.getMetadata('xrp', 'xrpl-rpc');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('xrpl-rpc');
      expect(metadata?.displayName).toBe('XRPL RPC');
      expect(metadata?.blockchain).toBe('xrp');
    });

    it('should have correct capabilities', () => {
      const metadata = providerRegistry.getMetadata('xrp', 'xrpl-rpc');
      expect(metadata?.capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(metadata?.capabilities.supportedOperations).toContain('getAddressBalances');
      expect(metadata?.capabilities.supportedOperations).toContain('getAddressTokenBalances');
      expect(metadata?.capabilities.supportedOperations).toContain('getTokenMetadata');
    });

    it('should have correct configuration', () => {
      const metadata = providerRegistry.getMetadata('xrp', 'xrpl-rpc');
      expect(metadata?.requiresApiKey).toBe(false);
      expect(metadata?.defaultConfig.timeout).toBe(30000);
      expect(metadata?.defaultConfig.retries).toBe(3);
    });
  });
});
