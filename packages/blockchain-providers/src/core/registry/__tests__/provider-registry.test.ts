/**
 * Tests for ProviderRegistry — registration, metadata, instance creation, and config validation.
 */

import { getErrorMessage } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import { createProviderRegistry } from '../../../initialize.js';
import type { ProviderFactory, ProviderMetadata } from '../../types/index.js';
import { ProviderRegistry } from '../provider-registry.js';

describe('ProviderRegistry', () => {
  const providerRegistry = createProviderRegistry();

  test('should have registered Moralis provider', () => {
    expect(providerRegistry.isRegistered('ethereum', 'moralis')).toBe(true);
  });

  test('should list Moralis in available Ethereum providers', () => {
    const availableEthereumProviders = providerRegistry.getAvailable('ethereum');
    expect(availableEthereumProviders.length).toBeGreaterThanOrEqual(1);

    const moralis = availableEthereumProviders.find((p) => p.name === 'moralis');
    expect(moralis).toBeDefined();
    expect(moralis?.blockchain).toBe('ethereum');
    expect(moralis?.displayName).toBe('Moralis');
    expect(moralis?.requiresApiKey).toBe(true);
  });

  test('should have correct provider metadata', () => {
    const metadata = providerRegistry.getMetadata('ethereum', 'moralis');

    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe('moralis');
    expect(metadata?.blockchain).toBe('ethereum');
    expect(metadata?.displayName).toBe('Moralis');
    expect(metadata?.requiresApiKey).toBe(true);
    expect(metadata?.defaultConfig).toBeDefined();
    expect(metadata?.baseUrl).toBe('https://deep-index.moralis.io/api/v2.2');
  });

  test('should create provider instances from registry', () => {
    const config = providerRegistry.createDefaultConfig('ethereum', 'moralis');
    const provider = providerRegistry.createProvider('ethereum', 'moralis', config);

    expect(provider).toBeDefined();
    expect(provider.name).toBe('moralis');
    expect(provider.blockchain).toBe('ethereum');
    expect(provider.capabilities).toBeDefined();
    expect(provider.capabilities.supportedOperations).toContain('getAddressBalances');
  });

  test('should reject mismatched metadata when provided explicitly', () => {
    const config = providerRegistry.createDefaultConfig('ethereum', 'moralis');
    const mismatchedMetadata = {
      ...config.metadata,
      name: 'wrong-provider',
    } as ProviderMetadata;

    expect(() =>
      providerRegistry.createProvider('ethereum', 'moralis', {
        ...config,
        metadata: mismatchedMetadata,
      })
    ).toThrow(/metadata mismatch/i);
  });

  test('should validate legacy configuration correctly', () => {
    const validConfig = {
      ethereum: { explorers: [{ enabled: true, name: 'moralis', priority: 1 }] },
    };
    const invalidConfig = {
      ethereum: { explorers: [{ enabled: true, name: 'invalid-provider', priority: 1 }] },
    };

    const validResult = providerRegistry.validateConfig(validConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidResult = providerRegistry.validateConfig(invalidConfig);
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

    const validResult = providerRegistry.validateConfig(validOverrideConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidResult = providerRegistry.validateConfig(invalidOverrideConfig);
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
      providerRegistry.createProvider('ethereum', 'non-existent', minimalConfig);
    }).toThrow(/Provider 'non-existent' not found for blockchain ethereum/);

    try {
      providerRegistry.createProvider('ethereum', 'non-existent', minimalConfig);
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
    expect(providerRegistry.getAvailable('non-existent-blockchain')).toHaveLength(0);
  });

  test('should provide provider capabilities information', () => {
    const availableEthereumProviders = providerRegistry.getAvailable('ethereum');
    const moralis = availableEthereumProviders.find((p) => p.name === 'moralis');
    expect(moralis?.capabilities).toBeDefined();
    expect(moralis?.capabilities.supportedOperations).toBeDefined();
  });

  test('should provide rate limiting information', () => {
    const availableEthereumProviders = providerRegistry.getAvailable('ethereum');
    const moralis = availableEthereumProviders.find((p) => p.name === 'moralis');
    expect(moralis?.defaultConfig.rateLimit).toBeDefined();
    expect(moralis?.defaultConfig.rateLimit.requestsPerSecond).toBe(2);
    expect(moralis?.defaultConfig.rateLimit.burstLimit).toBe(5);
  });
});

describe('ProviderRegistry — instance isolation', () => {
  const sourceRegistry = createProviderRegistry();

  test('instance registry is isolated from another registry instance', () => {
    const isolated = new ProviderRegistry();

    // Isolated registry starts empty
    expect(isolated.hasAnyProviders()).toBe(false);
    expect(isolated.getAvailable('ethereum')).toHaveLength(0);

    // Independent populated instance still has providers
    expect(sourceRegistry.hasAnyProviders()).toBe(true);
    expect(sourceRegistry.getAvailable('ethereum').length).toBeGreaterThan(0);
  });

  test('registering into an instance does not affect another registry instance', () => {
    const isolated = new ProviderRegistry();

    const testFactory: ProviderFactory = {
      create: () => ({ name: 'test-provider', blockchain: 'test-chain' }) as never,
      metadata: {
        name: 'test-provider',
        displayName: 'Test Provider',
        blockchain: 'test-chain',
        baseUrl: 'https://test.example.com',
        capabilities: { supportedOperations: ['getAddressBalances'] },
        defaultConfig: {
          rateLimit: { requestsPerSecond: 1 },
          retries: 1,
          timeout: 5000,
        },
      },
    };

    isolated.register(testFactory);

    // Visible in the isolated instance
    expect(isolated.isRegistered('test-chain', 'test-provider')).toBe(true);
    expect(isolated.getAvailable('test-chain')).toHaveLength(1);

    // Not visible in the separate populated instance
    expect(sourceRegistry.isRegistered('test-chain', 'test-provider')).toBe(false);
    expect(sourceRegistry.getAvailable('test-chain')).toHaveLength(0);
  });

  test('instance can create providers from its own registrations', () => {
    const isolated = new ProviderRegistry();

    const mockProvider = { name: 'mock', blockchain: 'mock-chain' } as never;
    isolated.register({
      create: () => mockProvider,
      metadata: {
        name: 'mock',
        displayName: 'Mock',
        blockchain: 'mock-chain',
        baseUrl: 'https://mock.test',
        capabilities: { supportedOperations: [] },
        defaultConfig: { rateLimit: { requestsPerSecond: 1 }, retries: 1, timeout: 1000 },
      },
    });

    const provider = isolated.createProvider('mock-chain', 'mock', {
      baseUrl: 'https://mock.test',
      blockchain: 'mock-chain',
      displayName: 'Mock',
      name: 'mock',
      rateLimit: { requestsPerSecond: 1 },
      retries: 1,
      timeout: 1000,
    });

    expect(provider).toBe(mockProvider);
  });
});
