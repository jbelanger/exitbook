/**
 * Tests for ProviderRegistry — registration, metadata, instance creation, and config validation.
 */

import { getErrorMessage } from '@exitbook/core';
import { beforeAll, describe, expect, test } from 'vitest';

import { initializeProviders } from '../../../initialize.js';
import type { ProviderInfo } from '../../types/index.js';
import { ProviderRegistry } from '../provider-registry.js';

describe('ProviderRegistry', () => {
  let availableEthereumProviders: ProviderInfo[];

  beforeAll(() => {
    initializeProviders();
    availableEthereumProviders = ProviderRegistry.getAvailable('ethereum');
  });

  test('should have registered Moralis provider', () => {
    expect(ProviderRegistry.isRegistered('ethereum', 'moralis')).toBe(true);
  });

  test('should list Moralis in available Ethereum providers', () => {
    expect(availableEthereumProviders.length).toBeGreaterThanOrEqual(1);

    const moralis = availableEthereumProviders.find((p) => p.name === 'moralis');
    expect(moralis).toBeDefined();
    expect(moralis?.blockchain).toBe('ethereum');
    expect(moralis?.displayName).toBe('Moralis');
    expect(moralis?.requiresApiKey).toBe(true);
  });

  test('should have correct provider metadata', () => {
    const metadata = ProviderRegistry.getMetadata('ethereum', 'moralis');

    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe('moralis');
    expect(metadata?.blockchain).toBe('ethereum');
    expect(metadata?.displayName).toBe('Moralis');
    expect(metadata?.requiresApiKey).toBe(true);
    expect(metadata?.defaultConfig).toBeDefined();
    expect(metadata?.baseUrl).toBe('https://deep-index.moralis.io/api/v2.2');
  });

  test('should create provider instances from registry', () => {
    const metadata = ProviderRegistry.getMetadata('ethereum', 'moralis')!;

    const config = {
      ...metadata.defaultConfig,
      baseUrl: metadata.baseUrl,
      blockchain: 'ethereum',
      displayName: metadata.displayName,
      name: metadata.name,
      requiresApiKey: metadata.requiresApiKey,
    };

    const provider = ProviderRegistry.createProvider('ethereum', 'moralis', config);

    expect(provider).toBeDefined();
    expect(provider.name).toBe('moralis');
    expect(provider.blockchain).toBe('ethereum');
    expect(provider.capabilities).toBeDefined();
    expect(provider.capabilities.supportedOperations).toContain('getAddressBalances');
  });

  test('should validate legacy configuration correctly', () => {
    const validConfig = {
      ethereum: { explorers: [{ enabled: true, name: 'moralis', priority: 1 }] },
    };
    const invalidConfig = {
      ethereum: { explorers: [{ enabled: true, name: 'invalid-provider', priority: 1 }] },
    };

    const validResult = ProviderRegistry.validateConfig(validConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidResult = ProviderRegistry.validateConfig(invalidConfig);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
    expect(invalidResult.errors[0]).toContain('invalid-provider');
  });

  test('should validate new override-based configuration correctly', () => {
    const validOverrideConfig = {
      ethereum: {
        defaultEnabled: ['routescan', 'moralis'],
        overrides: {
          routescan: { priority: 1, rateLimit: { requestsPerSecond: 0.5 } },
          moralis: { enabled: false },
        },
      },
    };
    const invalidOverrideConfig = {
      ethereum: { defaultEnabled: ['invalid-provider'], overrides: {} },
    };

    const validResult = ProviderRegistry.validateConfig(validOverrideConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidResult = ProviderRegistry.validateConfig(invalidOverrideConfig);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
    expect(invalidResult.errors[0]).toContain('invalid-provider');
  });

  test('should throw error with helpful suggestions for non-existent providers', () => {
    const minimalConfig = {
      baseUrl: 'https://test.com',
      blockchain: 'ethereum',
      displayName: 'Test',
      name: 'non-existent',
      rateLimit: { requestsPerSecond: 1 },
      retries: 3,
      timeout: 10000,
    };

    expect(() => {
      ProviderRegistry.createProvider('ethereum', 'non-existent', minimalConfig);
    }).toThrow(/Provider 'non-existent' not found for blockchain ethereum/);

    try {
      ProviderRegistry.createProvider('ethereum', 'non-existent', minimalConfig);
    } catch (error) {
      const message = getErrorMessage(error);
      expect(message).toContain('💡 Available providers');
      expect(message).toContain('💡 Run');
      expect(message).toContain('providers:list');
      expect(message).toContain('💡 Check for typos');
      expect(message).toContain('providers:sync --fix');
    }
  });

  test('should handle empty blockchain configurations', () => {
    expect(ProviderRegistry.getAvailable('non-existent-blockchain')).toHaveLength(0);
  });

  test('should provide provider capabilities information', () => {
    const moralis = availableEthereumProviders.find((p) => p.name === 'moralis');
    expect(moralis?.capabilities).toBeDefined();
    expect(moralis?.capabilities.supportedOperations).toBeDefined();
  });

  test('should provide rate limiting information', () => {
    const moralis = availableEthereumProviders.find((p) => p.name === 'moralis');
    expect(moralis?.defaultConfig.rateLimit).toBeDefined();
    expect(moralis?.defaultConfig.rateLimit.requestsPerSecond).toBe(2);
    expect(moralis?.defaultConfig.rateLimit.burstLimit).toBe(5);
  });
});
